-- Flappy13 v0.2.7.3b-dev4 - verified-run retention.
-- Run after 005_player_stats.sql.
-- Keeps the 50 most recently started verified runs per player plus the
-- authoritative historical best run when it is not already among those 50.
-- issued and rejected rows are intentionally untouched by this migration.

create or replace function public.prune_verified_runs_for_player(target_player_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer := 0;
begin
  if target_player_id is null then
    return 0;
  end if;

  -- Serialize retention for one player. This keeps the 50(+record) bound stable
  -- even if two server submissions for the same account resolve concurrently.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_player_id::text, 0)
  );

  with recent_runs as (
    select vr.run_id
    from public.verified_runs as vr
    where vr.player_id = target_player_id
      and vr.status = 'verified'
    -- "Recent" means when the run was actually started. A run completed
    -- offline and uploaded later must not jump to the front of the window.
    order by vr.issued_at desc, vr.run_id desc
    limit 50
  ),
  historical_best as (
    select vr.run_id
    from public.verified_runs as vr
    where vr.player_id = target_player_id
      and vr.status = 'verified'
      and vr.verified_score is not null
      and vr.resolved_at is not null
    -- Same deterministic record rule as get_leaderboard() / player_stats.
    order by
      vr.verified_score desc,
      vr.resolved_at asc,
      vr.run_id asc
    limit 1
  ),
  keep_runs as (
    select rr.run_id from recent_runs as rr
    union
    select hb.run_id from historical_best as hb
  ),
  deleted as (
    delete from public.verified_runs as vr
    where vr.player_id = target_player_id
      and vr.status = 'verified'
      and not exists (
        select 1
        from keep_runs as kr
        where kr.run_id = vr.run_id
      )
    returning vr.run_id
  )
  select count(*)::integer
  into deleted_count
  from deleted;

  return deleted_count;
end;
$$;

revoke all on function public.prune_verified_runs_for_player(uuid)
  from public, anon, authenticated;
grant execute on function public.prune_verified_runs_for_player(uuid)
  to service_role;

comment on function public.prune_verified_runs_for_player(uuid) is
  'Server-only retention: keep the 50 most recently issued verified runs plus the deterministic historical best run for one player.';

create or replace function public.prune_verified_runs_after_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.prune_verified_runs_for_player(new.player_id);
  return new;
end;
$$;

revoke all on function public.prune_verified_runs_after_verification()
  from public, anon, authenticated;

-- Trigger names intentionally sort after the player_stats_* triggers from 005.
-- PostgreSQL fires same-kind triggers in name order, so lifetime aggregates are
-- persisted before old detailed rows can be removed.
drop trigger if exists zz_verified_run_retention_on_insert on public.verified_runs;
create trigger zz_verified_run_retention_on_insert
after insert on public.verified_runs
for each row
when (new.status = 'verified')
execute procedure public.prune_verified_runs_after_verification();

drop trigger if exists zz_verified_run_retention_on_update on public.verified_runs;
create trigger zz_verified_run_retention_on_update
after update of status on public.verified_runs
for each row
when (new.status = 'verified' and old.status is distinct from 'verified')
execute procedure public.prune_verified_runs_after_verification();

-- One-time cleanup for data that existed before this migration. player_stats
-- has already been backfilled by 005, so deleting detailed historical rows here
-- cannot erase lifetime counters.
do $$
declare
  target_player_id uuid;
begin
  for target_player_id in
    select distinct vr.player_id
    from public.verified_runs as vr
    where vr.status = 'verified'
  loop
    perform public.prune_verified_runs_for_player(target_player_id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
