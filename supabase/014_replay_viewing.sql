-- Flappy13 v0.2.7.6b - public replay viewing from the leaderboard.
-- Run after 013_profile_permissions_hotfix.sql. Safe to run more than once.

alter table public.verified_runs
  add column if not exists visual_theme text,
  add column if not exists visual_variant text;

alter table public.verified_runs
  drop constraint if exists verified_runs_visual_theme_valid,
  drop constraint if exists verified_runs_visual_variant_valid,
  drop constraint if exists verified_runs_visual_context_shape_valid;

alter table public.verified_runs
  add constraint verified_runs_visual_theme_valid
    check (
      visual_theme is null
      or visual_theme ~ '^[a-z0-9][a-z0-9_-]{0,31}$'
    ),
  add constraint verified_runs_visual_variant_valid
    check (
      visual_variant is null
      or visual_variant in ('day', 'night')
    ),
  add constraint verified_runs_visual_context_shape_valid
    check (
      (visual_theme is null and visual_variant is null)
      or (visual_theme is not null and visual_variant is not null)
    );

comment on column public.verified_runs.visual_theme is
  'Theme identifier captured by the client for replay rendering only. It never affects authoritative physics verification.';
comment on column public.verified_runs.visual_variant is
  'Effective day/night variant captured by the client for replay rendering only. It never affects authoritative physics verification.';

-- The added run_id OUT column changes the function return type. PostgreSQL does
-- not permit CREATE OR REPLACE to change OUT parameters, so replace the old
-- signature atomically inside this migration.
drop function if exists public.get_leaderboard(integer);

create function public.get_leaderboard(limit_count integer default 100)
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
  with player_bests as (
    select distinct on (vr.player_id)
      vr.run_id,
      vr.player_id,
      vr.verified_score as score,
      vr.resolved_at as achieved_at
    from public.verified_runs as vr
    where vr.status = 'verified'
      and vr.verified_score is not null
      and vr.resolved_at is not null
    order by
      vr.player_id,
      vr.verified_score desc,
      vr.resolved_at asc,
      vr.run_id asc
  ),
  ranked as (
    select
      row_number() over (
        order by pb.score desc, pb.achieved_at asc, pb.player_id asc
      ) as rank,
      pb.run_id,
      pb.player_id,
      p.username,
      p.display_name,
      p.avatar_url,
      pb.score,
      pb.achieved_at
    from player_bests as pb
    left join public.profiles as p on p.id = pb.player_id
  )
  select
    r.rank,
    r.run_id,
    r.player_id,
    r.username,
    r.display_name,
    r.avatar_url,
    r.score,
    r.achieved_at
  from ranked as r
  order by r.rank
  limit greatest(1, least(coalesce(limit_count, 100), 100));
$$;

revoke all on function public.get_leaderboard(integer) from public;
grant execute on function public.get_leaderboard(integer) to anon, authenticated, service_role;

comment on function public.get_leaderboard(integer) is
  'Public top-100 leaderboard built only from authoritative verified runs, one best score per player, including the run id required to request its replay.';

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
  where vr.run_id = target_run_id
    and vr.status = 'verified'
    and vr.verified_score is not null
    and vr.resolved_at is not null
    and vr.terminal_tick is not null
    and vr.tap_ticks is not null
    and exists (
      select 1
      from public.get_leaderboard(100) as leaderboard
      where leaderboard.run_id = vr.run_id
    )
  limit 1;
$$;

revoke all on function public.get_leaderboard_replay(uuid) from public;
grant execute on function public.get_leaderboard_replay(uuid) to anon, authenticated, service_role;

comment on function public.get_leaderboard_replay(uuid) is
  'Returns deterministic replay inputs only for a run currently exposed in the public top-100 leaderboard.';

notify pgrst, 'reload schema';
