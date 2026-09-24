-- Flappy13 v0.2.8b-hotfix1 - keep leaderboard record-tenure tracking
-- out of the critical verified-run path.
--
-- 019 introduced a synchronous player_stats trigger to keep the current #1
-- tenure exact. A leaderboard-side enhancement must never be able to abort a
-- verified run if its bookkeeping fails, so this migration makes the trigger
-- best-effort, narrows UPDATE firing to real personal-best changes, and uses a
-- simple fixed advisory lock for the tiny global critical section.

begin;

create or replace function public.sync_leaderboard_record_state(candidate_since timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  top_player_id uuid;
  top_run_id uuid;
  top_score integer;
  top_score_at timestamptz;
  current_player_id uuid;
begin
  -- Serialize only the world-record singleton update. The fixed two-int key is
  -- intentionally boring and portable; this function is server-only.
  perform pg_catalog.pg_advisory_xact_lock(208, 1);

  select
    ps.player_id,
    ps.best_run_id,
    ps.best_score,
    ps.best_score_at
  into
    top_player_id,
    top_run_id,
    top_score,
    top_score_at
  from public.player_stats as ps
  where ps.best_run_id is not null
    and ps.best_score_at is not null
  order by
    ps.best_score desc,
    ps.best_score_at asc,
    ps.player_id asc
  limit 1;

  if top_player_id is null then
    delete from public.leaderboard_record_state where singleton = true;
    return;
  end if;

  select rs.player_id
  into current_player_id
  from public.leaderboard_record_state as rs
  where rs.singleton = true;

  if found and current_player_id = top_player_id then
    update public.leaderboard_record_state
    set run_id = top_run_id,
        score = top_score,
        updated_at = now()
    where singleton = true;
    return;
  end if;

  insert into public.leaderboard_record_state (
    singleton,
    player_id,
    run_id,
    score,
    held_since,
    updated_at
  ) values (
    true,
    top_player_id,
    top_run_id,
    top_score,
    coalesce(candidate_since, top_score_at, statement_timestamp()),
    now()
  )
  on conflict (singleton) do update
  set player_id = excluded.player_id,
      run_id = excluded.run_id,
      score = excluded.score,
      held_since = excluded.held_since,
      updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.sync_leaderboard_record_state(timestamptz)
  from public, anon, authenticated;
grant execute on function public.sync_leaderboard_record_state(timestamptz)
  to service_role;

create or replace function public.capture_leaderboard_record_state_from_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The leaderboard tenure is derived metadata. Never let it roll back the
  -- authoritative verified-run transition or player_stats update.
  begin
    if tg_op = 'DELETE' then
      perform public.sync_leaderboard_record_state(statement_timestamp());
    else
      perform public.sync_leaderboard_record_state(new.best_score_at);
    end if;
  exception when others then
    raise warning '[leaderboard_record_state] sync skipped (SQLSTATE %): %', sqlstate, sqlerrm;
  end;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.capture_leaderboard_record_state_from_stats()
  from public, anon, authenticated;

-- INSERT still matters for the first verified run of a player.
drop trigger if exists leaderboard_record_state_on_stats_insert on public.player_stats;
create trigger leaderboard_record_state_on_stats_insert
after insert on public.player_stats
for each row
execute procedure public.capture_leaderboard_record_state_from_stats();

-- PostgreSQL UPDATE OF fires when a column appears in SET even if its value did
-- not actually change. The player_stats upsert touches the best_* columns for
-- every verified run, so add a WHEN predicate and avoid global record work for
-- ordinary non-record runs.
drop trigger if exists leaderboard_record_state_on_stats_update on public.player_stats;
create trigger leaderboard_record_state_on_stats_update
after update of best_score, best_run_id, best_score_at on public.player_stats
for each row
when (
  old.best_score is distinct from new.best_score
  or old.best_run_id is distinct from new.best_run_id
  or old.best_score_at is distinct from new.best_score_at
)
execute procedure public.capture_leaderboard_record_state_from_stats();

drop trigger if exists leaderboard_record_state_on_stats_delete on public.player_stats;
create trigger leaderboard_record_state_on_stats_delete
after delete on public.player_stats
for each row
execute procedure public.capture_leaderboard_record_state_from_stats();

-- Best-effort repair at deploy time as well. A failure is logged but does not
-- roll back this resilience migration.
do $$
begin
  perform public.sync_leaderboard_record_state(null);
exception when others then
  raise warning '[leaderboard_record_state] deploy-time repair skipped (SQLSTATE %): %', sqlstate, sqlerrm;
end;
$$;

notify pgrst, 'reload schema';

commit;
