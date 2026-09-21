-- Flappy13 v0.2.7.3b-dev6 - authenticated career and recent performance statistics.
-- Run after 007_personal_leaderboard_context.sql.
-- Lifetime values come from server-owned player_stats; recent windows are derived
-- only from retained authoritative verified_runs rows ordered by issued_at.

create or replace function public.get_my_player_performance_stats()
returns table (
  player_id uuid,
  verified_runs_count bigint,
  total_score bigint,
  career_average numeric,
  best_score integer,
  first_verified_run_at timestamptz,
  last_verified_run_at timestamptz,
  recent_10_count bigint,
  recent_10_average numeric,
  recent_10_best integer,
  recent_10_median numeric,
  recent_10_stddev numeric,
  recent_25_count bigint,
  recent_25_average numeric,
  recent_25_best integer,
  recent_25_median numeric,
  recent_25_stddev numeric,
  recent_50_count bigint,
  recent_50_average numeric,
  recent_50_best integer,
  recent_50_median numeric,
  recent_50_stddev numeric,
  recent_50_vs_career_pct numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select auth.uid() as player_id
  ),
  recent as (
    select
      vr.player_id,
      vr.verified_score,
      row_number() over (
        partition by vr.player_id
        order by vr.issued_at desc, vr.run_id desc
      ) as recent_rank
    from public.verified_runs as vr
    join me on me.player_id = vr.player_id
    where vr.status = 'verified'
      and vr.verified_score is not null
  ),
  recent_agg as (
    select
      r.player_id,
      count(*) filter (where r.recent_rank <= 10)::bigint as recent_10_count,
      avg(r.verified_score) filter (where r.recent_rank <= 10) as recent_10_average,
      max(r.verified_score) filter (where r.recent_rank <= 10) as recent_10_best,
      percentile_cont(0.5) within group (order by r.verified_score)
        filter (where r.recent_rank <= 10) as recent_10_median,
      stddev_pop(r.verified_score) filter (where r.recent_rank <= 10) as recent_10_stddev,
      count(*) filter (where r.recent_rank <= 25)::bigint as recent_25_count,
      avg(r.verified_score) filter (where r.recent_rank <= 25) as recent_25_average,
      max(r.verified_score) filter (where r.recent_rank <= 25) as recent_25_best,
      percentile_cont(0.5) within group (order by r.verified_score)
        filter (where r.recent_rank <= 25) as recent_25_median,
      stddev_pop(r.verified_score) filter (where r.recent_rank <= 25) as recent_25_stddev,
      count(*) filter (where r.recent_rank <= 50)::bigint as recent_50_count,
      avg(r.verified_score) filter (where r.recent_rank <= 50) as recent_50_average,
      max(r.verified_score) filter (where r.recent_rank <= 50) as recent_50_best,
      percentile_cont(0.5) within group (order by r.verified_score)
        filter (where r.recent_rank <= 50) as recent_50_median,
      stddev_pop(r.verified_score) filter (where r.recent_rank <= 50) as recent_50_stddev
    from recent as r
    where r.recent_rank <= 50
    group by r.player_id
  )
  select
    me.player_id,
    coalesce(ps.verified_runs_count, 0)::bigint,
    coalesce(ps.total_score, 0)::bigint,
    case
      when coalesce(ps.verified_runs_count, 0) > 0
        then ps.total_score::numeric / ps.verified_runs_count::numeric
      else null
    end as career_average,
    case when coalesce(ps.verified_runs_count, 0) > 0 then ps.best_score else null end,
    ps.first_verified_run_at,
    ps.last_verified_run_at,
    coalesce(ra.recent_10_count, 0)::bigint,
    ra.recent_10_average,
    ra.recent_10_best,
    ra.recent_10_median,
    ra.recent_10_stddev,
    coalesce(ra.recent_25_count, 0)::bigint,
    ra.recent_25_average,
    ra.recent_25_best,
    ra.recent_25_median,
    ra.recent_25_stddev,
    coalesce(ra.recent_50_count, 0)::bigint,
    ra.recent_50_average,
    ra.recent_50_best,
    ra.recent_50_median,
    ra.recent_50_stddev,
    case
      when coalesce(ps.verified_runs_count, 0) > 0
        and ra.recent_50_count > 0
        and ps.total_score > 0
      then (
        (ra.recent_50_average - (ps.total_score::numeric / ps.verified_runs_count::numeric))
        / nullif((ps.total_score::numeric / ps.verified_runs_count::numeric), 0)
      ) * 100
      else null
    end as recent_50_vs_career_pct
  from me
  left join public.player_stats as ps on ps.player_id = me.player_id
  left join recent_agg as ra on ra.player_id = me.player_id
  where me.player_id is not null;
$$;

revoke all on function public.get_my_player_performance_stats() from public, anon;
grant execute on function public.get_my_player_performance_stats() to authenticated, service_role;

comment on function public.get_my_player_performance_stats() is
  'Authenticated caller-only career and 10/25/50-run statistics derived exclusively from authoritative verified data.';

notify pgrst, 'reload schema';
