-- Flappy13 v0.2.7.3b-dev6.3.6 - verified-run ticket hygiene.
-- Run after 008_player_performance_stats.sql.
--
-- Goals:
--   * keep abandoned issued tickets bounded without breaking short/medium offline play;
--   * retain rejected rows long enough for diagnosis, but not forever;
--   * serialize run-start issuance per player and enforce conservative abuse guards;
--   * schedule cleanup hourly with Supabase Cron / pg_cron.

-- pg_cron creates and owns the cron schema itself.
create extension if not exists pg_cron;

create index if not exists verified_runs_issued_cleanup_idx
  on public.verified_runs (issued_at)
  where status = 'issued';

create index if not exists verified_runs_rejected_cleanup_idx
  on public.verified_runs (resolved_at)
  where status = 'rejected';

create or replace function public.cleanup_stale_verified_run_tickets()
returns table (
  issued_deleted integer,
  rejected_deleted integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleanup_now timestamptz := statement_timestamp();
  issued_count integer := 0;
  rejected_count integer := 0;
begin
  with deleted as (
    delete from public.verified_runs as vr
    where vr.status = 'issued'
      and vr.issued_at < cleanup_now - interval '7 days'
    returning 1
  )
  select count(*)::integer
  into issued_count
  from deleted;

  with deleted as (
    delete from public.verified_runs as vr
    where vr.status = 'rejected'
      and vr.resolved_at < cleanup_now - interval '30 days'
    returning 1
  )
  select count(*)::integer
  into rejected_count
  from deleted;

  return query select issued_count, rejected_count;
end;
$$;

revoke all on function public.cleanup_stale_verified_run_tickets()
  from public, anon, authenticated;
grant execute on function public.cleanup_stale_verified_run_tickets()
  to service_role;

comment on function public.cleanup_stale_verified_run_tickets() is
  'Server-only hygiene: delete issued tickets older than 7 days and rejected runs older than 30 days; verified retention remains managed by 006.';

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
  open_issued integer := 0;
  starts_last_minute integer := 0;
  oldest_recent_start timestamptz;
  wait_seconds integer := null;
  created_run_id uuid;
  created_seed integer;
  created_physics_version text;
  created_issued_at timestamptz;
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

  -- One issuance decision at a time per player. This makes the pending-ticket
  -- cap and the rolling one-minute limit atomic under concurrent run-start calls.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_player_id::text, 636)
  );

  -- Opportunistically expire this player's abandoned tickets before enforcing
  -- the cap. The global hourly cleanup below covers players who never return.
  delete from public.verified_runs as vr
  where vr.player_id = target_player_id
    and vr.status = 'issued'
    and vr.issued_at < issue_now - interval '7 days';

  select count(*)::integer
  into open_issued
  from public.verified_runs as vr
  where vr.player_id = target_player_id
    and vr.status = 'issued';

  if open_issued >= 10 then
    return query
      select 'too_many_pending_runs'::text, null::uuid, null::integer, null::text,
             null::timestamptz, null::integer, open_issued;
    return;
  end if;

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

    return query
      select 'rate_limited'::text, null::uuid, null::integer, null::text,
             null::timestamptz, wait_seconds, open_issued;
    return;
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
  'Server-only atomic run-start issuer: max 10 open issued tickets and max 30 starts per rolling minute per player.';

-- One-time hygiene for rows that predate this migration.
select * from public.cleanup_stale_verified_run_tickets();

-- The named job is idempotent in Supabase Cron: scheduling the same name again
-- replaces its definition. Minute 17 avoids stacking on the top of the hour.
select cron.schedule(
  'flappy13-verified-run-ticket-hygiene',
  '17 * * * *',
  $cron$select public.cleanup_stale_verified_run_tickets();$cron$
);

notify pgrst, 'reload schema';
