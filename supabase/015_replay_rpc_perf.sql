-- Flappy13 v0.2.7.7b-hotfix3 - leaderboard/replay read-path optimization.
-- Run after 014_replay_viewing.sql. Safe to run more than once.
--
-- public.player_stats is server-owned and is maintained from authoritative
-- verified-run transitions. Its best_score / best_run_id / best_score_at fields
-- use the same deterministic record rule as the historical leaderboard query.
-- Reading that aggregate avoids de-duplicating public.verified_runs on every
-- leaderboard refresh and avoids calling get_leaderboard(100) again for every
-- replay click.

create index if not exists player_stats_public_leaderboard_rank_idx
  on public.player_stats (
    best_score desc,
    best_score_at asc,
    player_id asc
  )
  include (best_run_id)
  where best_run_id is not null
    and best_score_at is not null;

create or replace function public.get_leaderboard(limit_count integer default 100)
returns table (
  rank bigint,
  run_id uuid,
  player_id uuid,
  username text,
  display_name text,
  avatar_url text,
  score integer,
  achieved_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with top_players as (
    select
      ps.best_run_id as run_id,
      ps.player_id,
      ps.best_score as score,
      ps.best_score_at as achieved_at
    from public.player_stats as ps
    where ps.best_run_id is not null
      and ps.best_score_at is not null
    order by
      ps.best_score desc,
      ps.best_score_at asc,
      ps.player_id asc
    limit greatest(1, least(coalesce(limit_count, 100), 100))
  )
  select
    row_number() over (
      order by tp.score desc, tp.achieved_at asc, tp.player_id asc
    ) as rank,
    tp.run_id,
    tp.player_id,
    p.username,
    p.display_name,
    p.avatar_url,
    tp.score,
    tp.achieved_at
  from top_players as tp
  left join public.profiles as p on p.id = tp.player_id
  order by tp.score desc, tp.achieved_at asc, tp.player_id asc;
$$;

revoke all on function public.get_leaderboard(integer) from public;
grant execute on function public.get_leaderboard(integer) to anon, authenticated, service_role;

comment on function public.get_leaderboard(integer) is
  'Public top-100 leaderboard from authoritative player_stats aggregates derived exclusively from verified runs, with one deterministic best run per player.';

create or replace function public.get_leaderboard_replay(target_run_id uuid)
returns table (
  run_id uuid,
  player_id uuid,
  seed integer,
  physics_version text,
  terminal_tick integer,
  taps integer[],
  score integer,
  collision text,
  theme text,
  variant text,
  resolved_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with public_top_100 as (
    select ps.best_run_id
    from public.player_stats as ps
    where ps.best_run_id is not null
      and ps.best_score_at is not null
    order by
      ps.best_score desc,
      ps.best_score_at asc,
      ps.player_id asc
    limit 100
  )
  select
    vr.run_id,
    vr.player_id,
    vr.seed,
    vr.physics_version,
    vr.terminal_tick,
    vr.tap_ticks as taps,
    vr.verified_score as score,
    vr.collision,
    vr.visual_theme as theme,
    vr.visual_variant as variant,
    vr.resolved_at
  from public.verified_runs as vr
  join public_top_100 as leaderboard
    on leaderboard.best_run_id = vr.run_id
  where vr.run_id = target_run_id
    and vr.status = 'verified'
    and vr.verified_score is not null
    and vr.resolved_at is not null
    and vr.terminal_tick is not null
    and vr.tap_ticks is not null
  limit 1;
$$;

revoke all on function public.get_leaderboard_replay(uuid) from public;
grant execute on function public.get_leaderboard_replay(uuid) to anon, authenticated, service_role;

comment on function public.get_leaderboard_replay(uuid) is
  'Returns deterministic replay inputs only for an authoritative best run currently inside the public top 100. Eligibility is checked from player_stats without recomputing the leaderboard RPC.';

notify pgrst, 'reload schema';
