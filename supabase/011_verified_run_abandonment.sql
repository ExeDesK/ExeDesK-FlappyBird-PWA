-- Flappy13 v0.2.7.4b-dev5 - verified-run abandonment & non-blocking issuance.
-- Run after 010_admin_analytics.sql.
-- Safe to run more than once from the Supabase SQL Editor.
--
-- Goals:
--   * explicitly release an issued ticket when the player leaves READY via Home;
--   * never block normal play because too many issued rows already exist;
--   * keep storage bounded by pruning only when a player reaches a generous
--     server-side ceiling (100 issued rows), while preserving the 30/min abuse guard;
--   * retain the existing 7-day issued TTL and 30-day rejected TTL.

create or replace function public.cancel_verified_run(target_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  cancel_day date := (statement_timestamp() at time zone 'UTC')::date;
  cancelled boolean := false;
begin
  if caller_id is null or target_run_id is null then
    return false;
  end if;

  -- Serialize lifecycle changes for this player with run issuance.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 636)
  );

  delete from public.verified_runs as vr
  where vr.run_id = target_run_id
    and vr.player_id = caller_id
    and vr.status = 'issued'
  returning true into cancelled;

  if coalesce(cancelled, false) then
    -- This counter represents issued tickets that left the lifecycle without a
    -- submission (explicit cancel, TTL expiry or emergency server pruning).
    perform public.bump_run_metrics(
      cancel_day,
      delta_expired_issued_runs => 1
    );
    return true;
  end if;

  -- Idempotent/safe result: an already resolved/deleted run cannot be cancelled.
  return false;
end;
$$;

revoke all on function public.cancel_verified_run(uuid)
  from public, anon;
grant execute on function public.cancel_verified_run(uuid)
  to authenticated, service_role;

comment on function public.cancel_verified_run(uuid) is
  'Authenticated owner-only cancellation for an issued verified-run ticket, used when READY is abandoned before gameplay starts.';

-- Replace 010 issuance policy. The old hard 10-ticket rejection is removed:
-- existing pending rows can no longer lock a player out of ranked play.
-- Storage remains bounded by a generous rotating ceiling of 100 issued rows.
create or replace function public.issue_verified_run(
  target_player_id uuid,
  requested_seed integer,
  requested_physics_version text
)
returns table (
  result_code text,
  run_id uuid,
  seed integer,
  physics_version text,
  issued_at timestamptz,
  retry_after_seconds integer,
  pending_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  issue_now timestamptz := statement_timestamp();
  issue_day date := (statement_timestamp() at time zone 'UTC')::date;
  open_issued integer := 0;
  expired_for_player integer := 0;
  auto_pruned integer := 0;
  starts_last_minute integer := 0;
  oldest_recent_start timestamptz;
  wait_seconds integer := null;
  created_run_id uuid;
  created_seed integer;
  created_physics_version text;
  created_issued_at timestamptz;
  max_open_issued constant integer := 100;
begin
  if target_player_id is null
     or requested_seed is null
     or requested_physics_version is null
     or requested_physics_version !~ '^flappy13-physics-v[1-9][0-9]*$' then
    return query
      select 'invalid_request'::text, null::uuid, null::integer, null::text,
             null::timestamptz, null::integer, 0::integer;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_player_id::text, 636)
  );

  perform public.bump_run_metrics(issue_day, delta_run_start_requests => 1);

  -- Keep the existing long-lived offline-submission promise: only tickets older
  -- than seven days are considered stale solely because of age.
  with deleted as (
    delete from public.verified_runs as vr
    where vr.player_id = target_player_id
      and vr.status = 'issued'
      and vr.issued_at < issue_now - interval '7 days'
    returning 1
  )
  select count(*)::integer
  into expired_for_player
  from deleted;

  if expired_for_player > 0 then
    perform public.bump_run_metrics(
      issue_day,
      delta_expired_issued_runs => expired_for_player
    );
  end if;

  -- Abuse protection is independent from pending-row count. It remains the only
  -- intentional run-start block in normal operation.
  select count(*)::integer, min(vr.issued_at)
  into starts_last_minute, oldest_recent_start
  from public.verified_runs as vr
  where vr.player_id = target_player_id
    and vr.issued_at > issue_now - interval '1 minute';

  if starts_last_minute >= 30 then
    wait_seconds := greatest(
      1,
      ceil(extract(epoch from ((oldest_recent_start + interval '1 minute') - issue_now)))::integer
    );

    perform public.bump_run_metrics(issue_day, delta_rate_limited_requests => 1);

    return query
      select 'rate_limited'::text, null::uuid, null::integer, null::text,
             null::timestamptz, wait_seconds, 0::integer;
    return;
  end if;

  select count(*)::integer
  into open_issued
  from public.verified_runs as vr
  where vr.player_id = target_player_id
    and vr.status = 'issued';

  -- Never reject because the table already contains too many pending tickets.
  -- If an account somehow accumulates 100+, rotate the oldest issued rows out
  -- before issuing the new ticket. 100 is deliberately twice the client queue
  -- ceiling (50), leaving room for multi-device/offline use while bounding cost.
  if open_issued >= max_open_issued then
    with victims as (
      select vr.run_id
      from public.verified_runs as vr
      where vr.player_id = target_player_id
        and vr.status = 'issued'
      order by vr.issued_at asc, vr.run_id asc
      limit (open_issued - (max_open_issued - 1))
    ), deleted as (
      delete from public.verified_runs as vr
      using victims
      where vr.run_id = victims.run_id
      returning 1
    )
    select count(*)::integer into auto_pruned from deleted;

    if auto_pruned > 0 then
      perform public.bump_run_metrics(
        issue_day,
        delta_expired_issued_runs => auto_pruned,
        delta_pending_limit_requests => 1
      );
      open_issued := greatest(open_issued - auto_pruned, 0);
    end if;
  end if;

  insert into public.verified_runs (
    player_id,
    seed,
    physics_version
  ) values (
    target_player_id,
    requested_seed,
    requested_physics_version
  )
  returning
    verified_runs.run_id,
    verified_runs.seed,
    verified_runs.physics_version,
    verified_runs.issued_at
  into
    created_run_id,
    created_seed,
    created_physics_version,
    created_issued_at;

  perform public.bump_run_metrics(issue_day, delta_issued_runs => 1);

  return query
    select
      'issued'::text,
      created_run_id,
      created_seed,
      created_physics_version,
      created_issued_at,
      null::integer,
      open_issued + 1;
end;
$$;

revoke all on function public.issue_verified_run(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.issue_verified_run(uuid, integer, text)
  to service_role;

comment on function public.issue_verified_run(uuid, integer, text) is
  'Server-only atomic run-start issuer: never blocks on pending-row count; rotates oldest issued rows above 100 and keeps the 30 starts/minute abuse guard.';

notify pgrst, 'reload schema';
