-- Flappy13 v0.2.7.3b-dev5 - authenticated personal leaderboard context.
-- Run after 006_verified_run_retention.sql.
-- The browser never chooses a player_id: the RPC derives the caller from auth.uid().

create index if not exists player_stats_rank_idx
  on public.player_stats (best_score desc, best_score_at asc, player_id asc)
  where verified_runs_count > 0
    and best_run_id is not null
    and best_score_at is not null;

create or replace function public.get_my_leaderboard_context()
returns table (
  player_id uuid,
  global_rank bigint,
  best_score integer,
  verified_runs_count bigint,
  best_score_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select auth.uid() as player_id
  ),
  ranked as (
    select
      ps.player_id,
      row_number() over (
        order by
          ps.best_score desc,
          ps.best_score_at asc,
          ps.player_id asc
      ) as global_rank
    from public.player_stats as ps
    where ps.verified_runs_count > 0
      and ps.best_run_id is not null
      and ps.best_score_at is not null
  )
  select
    me.player_id,
    r.global_rank,
    ps.best_score,
    coalesce(ps.verified_runs_count, 0)::bigint as verified_runs_count,
    ps.best_score_at
  from me
  left join public.player_stats as ps
    on ps.player_id = me.player_id
  left join ranked as r
    on r.player_id = me.player_id
  where me.player_id is not null;
$$;

revoke all on function public.get_my_leaderboard_context() from public, anon;
grant execute on function public.get_my_leaderboard_context() to authenticated, service_role;

comment on function public.get_my_leaderboard_context() is
  'Authenticated caller-only leaderboard context: global rank, verified lifetime run count and authoritative historical record.';

notify pgrst, 'reload schema';
