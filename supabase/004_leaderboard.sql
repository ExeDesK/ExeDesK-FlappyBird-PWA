-- Flappy13 v0.2.7.3b-dev1 - public verified-runs leaderboard.
-- Run after 003_verified_runs.sql. Safe to run more than once.

create index if not exists verified_runs_player_best_idx
  on public.verified_runs (player_id, verified_score desc, resolved_at asc, run_id asc)
  where status = 'verified';

create or replace function public.get_leaderboard(limit_count integer default 100)
returns table (
  rank bigint,
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
  'Public top-100 leaderboard built only from authoritative verified runs, one best score per player.';

notify pgrst, 'reload schema';
