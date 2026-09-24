-- Flappy13 v0.2.7.8b - richer admin analytics with explicit UTC date ranges.
-- Run after 016_authenticated_replay_rate_limits.sql.
--
-- This migration intentionally keeps the legacy window_days RPCs from 010 for
-- backwards compatibility. The dashboard switches to these range-based RPCs.
-- All dates are inclusive UTC calendar dates and capped to 3650 days.

create or replace function public.admin_analytics_overview_range(
  date_from date default null,
  date_to date default null
)
returns table (
  tracking_started_at timestamptz,
  selected_from date,
  selected_to date,
  selected_days integer,
  total_players bigint,
  players_with_verified_runs bigint,
  active_players bigint,
  new_players bigint,
  new_active_players bigint,
  returning_active_players bigint,
  dau bigint,
  wau bigint,
  mau bigint,
  lifetime_verified_runs bigint,
  window_verified_runs bigint,
  tracked_play_ticks_total bigint,
  window_play_ticks bigint,
  global_best_score integer,
  period_best_score integer,
  lifetime_average_score numeric,
  window_average_score numeric,
  runs_per_active_player numeric,
  play_ticks_per_active_player numeric,
  pending_issued bigint,
  retained_rejected bigint,
  run_start_requests bigint,
  issued_runs bigint,
  rejected_runs bigint,
  expired_issued_runs bigint,
  purged_rejected_runs bigint,
  rate_limited_requests bigint,
  pending_limit_requests bigint,
  issue_rate_pct numeric,
  verification_rate_pct numeric,
  rejection_rate_pct numeric,
  deaths_pipe_top bigint,
  deaths_pipe_bottom bigint,
  deaths_ground bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  utc_today date := (statement_timestamp() at time zone 'UTC')::date;
  end_date date := least(coalesce(date_to, utc_today), utc_today);
  start_date date := coalesce(date_from, least(coalesce(date_to, utc_today), utc_today) - 29);
  days_count integer;
begin
  perform public.require_analytics_admin();

  if start_date > end_date then
    raise exception 'analytics_invalid_date_range'
      using errcode = '22023';
  end if;

  days_count := (end_date - start_date) + 1;
  if days_count > 3650 then
    raise exception 'analytics_date_range_too_large'
      using errcode = '22023';
  end if;

  return query
  with active_ids as (
    select distinct pad.player_id
    from public.player_activity_daily as pad
    where pad.activity_date between start_date and end_date
  ),
  activity as (
    select
      count(distinct pad.player_id)::bigint as active_players,
      coalesce(sum(pad.verified_runs), 0)::bigint as verified_runs,
      coalesce(sum(pad.play_ticks), 0)::bigint as play_ticks,
      coalesce(sum(pad.score_sum), 0)::bigint as score_sum,
      coalesce(max(pad.best_score), 0)::integer as period_best_score
    from public.player_activity_daily as pad
    where pad.activity_date between start_date and end_date
  ),
  active_split as (
    select
      count(*) filter (
        where (p.created_at at time zone 'UTC')::date between start_date and end_date
      )::bigint as new_active_players,
      count(*) filter (
        where (p.created_at at time zone 'UTC')::date < start_date
      )::bigint as returning_active_players
    from active_ids as ai
    join public.profiles as p on p.id = ai.player_id
  ),
  audience as (
    select
      count(distinct pad.player_id) filter (where pad.activity_date = end_date)::bigint as dau,
      count(distinct pad.player_id) filter (
        where pad.activity_date between end_date - 6 and end_date
      )::bigint as wau,
      count(distinct pad.player_id) filter (
        where pad.activity_date between end_date - 29 and end_date
      )::bigint as mau
    from public.player_activity_daily as pad
    where pad.activity_date between end_date - 29 and end_date
  ),
  stats as (
    select
      count(*) filter (where ps.verified_runs_count > 0)::bigint as players_with_runs,
      coalesce(sum(ps.verified_runs_count), 0)::bigint as lifetime_runs,
      coalesce(sum(ps.total_score), 0)::bigint as lifetime_score,
      coalesce(sum(ps.tracked_play_ticks), 0)::bigint as tracked_ticks,
      coalesce(max(ps.best_score), 0)::integer as global_best,
      coalesce(sum(ps.deaths_pipe_top), 0)::bigint as top_deaths,
      coalesce(sum(ps.deaths_pipe_bottom), 0)::bigint as bottom_deaths,
      coalesce(sum(ps.deaths_ground), 0)::bigint as ground_deaths
    from public.player_stats as ps
  ),
  profile_counts as (
    select
      count(*) filter (
        where (p.created_at at time zone 'UTC')::date <= end_date
      )::bigint as total_players,
      count(*) filter (
        where (p.created_at at time zone 'UTC')::date between start_date and end_date
      )::bigint as new_players
    from public.profiles as p
  ),
  metrics as (
    select
      coalesce(sum(rmd.run_start_requests), 0)::bigint as run_start_requests,
      coalesce(sum(rmd.issued_runs), 0)::bigint as issued_runs,
      coalesce(sum(rmd.rejected_runs), 0)::bigint as rejected_runs,
      coalesce(sum(rmd.expired_issued_runs), 0)::bigint as expired_issued_runs,
      coalesce(sum(rmd.purged_rejected_runs), 0)::bigint as purged_rejected_runs,
      coalesce(sum(rmd.rate_limited_requests), 0)::bigint as rate_limited_requests,
      coalesce(sum(rmd.pending_limit_requests), 0)::bigint as pending_limit_requests
    from public.run_metrics_daily as rmd
    where rmd.metric_date between start_date and end_date
  )
  select
    am.tracking_started_at,
    start_date,
    end_date,
    days_count,
    pc.total_players,
    s.players_with_runs,
    a.active_players,
    pc.new_players,
    asp.new_active_players,
    asp.returning_active_players,
    au.dau,
    au.wau,
    au.mau,
    s.lifetime_runs,
    a.verified_runs,
    s.tracked_ticks,
    a.play_ticks,
    s.global_best,
    a.period_best_score,
    case
      when s.lifetime_runs > 0 then s.lifetime_score::numeric / s.lifetime_runs::numeric
      else null
    end,
    case
      when a.verified_runs > 0 then a.score_sum::numeric / a.verified_runs::numeric
      else null
    end,
    case
      when a.active_players > 0 then a.verified_runs::numeric / a.active_players::numeric
      else null
    end,
    case
      when a.active_players > 0 then a.play_ticks::numeric / a.active_players::numeric
      else null
    end,
    (select count(*)::bigint from public.verified_runs as vr where vr.status = 'issued'),
    (select count(*)::bigint from public.verified_runs as vr where vr.status = 'rejected'),
    m.run_start_requests,
    m.issued_runs,
    m.rejected_runs,
    m.expired_issued_runs,
    m.purged_rejected_runs,
    m.rate_limited_requests,
    m.pending_limit_requests,
    case
      when m.run_start_requests > 0 then m.issued_runs::numeric * 100 / m.run_start_requests::numeric
      else null
    end,
    case
      when m.issued_runs > 0 then a.verified_runs::numeric * 100 / m.issued_runs::numeric
      else null
    end,
    case
      when m.issued_runs > 0 then m.rejected_runs::numeric * 100 / m.issued_runs::numeric
      else null
    end,
    s.top_deaths,
    s.bottom_deaths,
    s.ground_deaths
  from public.analytics_meta as am
  cross join activity as a
  cross join active_split as asp
  cross join audience as au
  cross join stats as s
  cross join profile_counts as pc
  cross join metrics as m
  where am.singleton = 1;
end;
$$;

revoke all on function public.admin_analytics_overview_range(date, date) from public, anon;
grant execute on function public.admin_analytics_overview_range(date, date) to authenticated, service_role;

create or replace function public.admin_analytics_daily_range(
  date_from date default null,
  date_to date default null
)
returns table (
  activity_date date,
  active_players bigint,
  new_active_players bigint,
  returning_players bigint,
  dau bigint,
  wau bigint,
  mau bigint,
  new_players bigint,
  verified_runs bigint,
  play_ticks bigint,
  score_sum bigint,
  best_score integer,
  average_score numeric,
  run_start_requests bigint,
  issued_runs bigint,
  rejected_runs bigint,
  expired_issued_runs bigint,
  purged_rejected_runs bigint,
  rate_limited_requests bigint,
  pending_limit_requests bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  utc_today date := (statement_timestamp() at time zone 'UTC')::date;
  end_date date := least(coalesce(date_to, utc_today), utc_today);
  start_date date := coalesce(date_from, least(coalesce(date_to, utc_today), utc_today) - 29);
  days_count integer;
begin
  perform public.require_analytics_admin();

  if start_date > end_date then
    raise exception 'analytics_invalid_date_range' using errcode = '22023';
  end if;
  days_count := (end_date - start_date) + 1;
  if days_count > 3650 then
    raise exception 'analytics_date_range_too_large' using errcode = '22023';
  end if;

  return query
  with dates as (
    select generate_series(start_date, end_date, interval '1 day')::date as activity_date
  ),
  activity as (
    select
      pad.activity_date,
      count(distinct pad.player_id)::bigint as active_players,
      count(distinct pad.player_id) filter (
        where (p.created_at at time zone 'UTC')::date = pad.activity_date
      )::bigint as new_active_players,
      count(distinct pad.player_id) filter (
        where (p.created_at at time zone 'UTC')::date < pad.activity_date
      )::bigint as returning_players,
      sum(pad.verified_runs)::bigint as verified_runs,
      sum(pad.play_ticks)::bigint as play_ticks,
      sum(pad.score_sum)::bigint as score_sum,
      max(pad.best_score)::integer as best_score
    from public.player_activity_daily as pad
    join public.profiles as p on p.id = pad.player_id
    where pad.activity_date between start_date and end_date
    group by pad.activity_date
  ),
  profiles as (
    select
      (p.created_at at time zone 'UTC')::date as activity_date,
      count(*)::bigint as new_players
    from public.profiles as p
    where (p.created_at at time zone 'UTC')::date between start_date and end_date
    group by (p.created_at at time zone 'UTC')::date
  )
  select
    d.activity_date,
    coalesce(a.active_players, 0)::bigint,
    coalesce(a.new_active_players, 0)::bigint,
    coalesce(a.returning_players, 0)::bigint,
    coalesce(a.active_players, 0)::bigint as dau,
    coalesce(audience.wau, 0)::bigint as wau,
    coalesce(audience.mau, 0)::bigint as mau,
    coalesce(p.new_players, 0)::bigint,
    coalesce(a.verified_runs, 0)::bigint,
    coalesce(a.play_ticks, 0)::bigint,
    coalesce(a.score_sum, 0)::bigint,
    coalesce(a.best_score, 0)::integer,
    case
      when coalesce(a.verified_runs, 0) > 0 then a.score_sum::numeric / a.verified_runs::numeric
      else null
    end,
    coalesce(rmd.run_start_requests, 0)::bigint,
    coalesce(rmd.issued_runs, 0)::bigint,
    coalesce(rmd.rejected_runs, 0)::bigint,
    coalesce(rmd.expired_issued_runs, 0)::bigint,
    coalesce(rmd.purged_rejected_runs, 0)::bigint,
    coalesce(rmd.rate_limited_requests, 0)::bigint,
    coalesce(rmd.pending_limit_requests, 0)::bigint
  from dates as d
  left join activity as a on a.activity_date = d.activity_date
  left join profiles as p on p.activity_date = d.activity_date
  left join public.run_metrics_daily as rmd on rmd.metric_date = d.activity_date
  left join lateral (
    select
      count(distinct pad.player_id) filter (
        where pad.activity_date between d.activity_date - 6 and d.activity_date
      )::bigint as wau,
      count(distinct pad.player_id) filter (
        where pad.activity_date between d.activity_date - 29 and d.activity_date
      )::bigint as mau
    from public.player_activity_daily as pad
    where pad.activity_date between d.activity_date - 29 and d.activity_date
  ) as audience on true
  order by d.activity_date;
end;
$$;

revoke all on function public.admin_analytics_daily_range(date, date) from public, anon;
grant execute on function public.admin_analytics_daily_range(date, date) to authenticated, service_role;

create or replace function public.admin_analytics_players_range(
  date_from date default null,
  date_to date default null,
  limit_count integer default 100,
  offset_count integer default 0,
  search_query text default null,
  sort_key text default 'runs'
)
returns table (
  global_rank bigint,
  player_id uuid,
  username text,
  display_name text,
  avatar_url text,
  period_verified_runs bigint,
  period_total_score bigint,
  period_average_score numeric,
  period_best_score integer,
  period_play_ticks bigint,
  period_active_days bigint,
  period_first_run_at timestamptz,
  period_last_run_at timestamptz,
  lifetime_verified_runs bigint,
  lifetime_best_score integer,
  tracked_play_ticks bigint,
  pending_issued bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  utc_today date := (statement_timestamp() at time zone 'UTC')::date;
  end_date date := least(coalesce(date_to, utc_today), utc_today);
  start_date date := coalesce(date_from, least(coalesce(date_to, utc_today), utc_today) - 29);
  days_count integer;
  row_limit integer := least(greatest(coalesce(limit_count, 100), 1), 500);
  row_offset integer := greatest(coalesce(offset_count, 0), 0);
  query_text text := nullif(btrim(coalesce(search_query, '')), '');
  ordering text := case
    when sort_key in ('record', 'playtime', 'recent', 'runs', 'active_days') then sort_key
    else 'runs'
  end;
begin
  perform public.require_analytics_admin();

  if start_date > end_date then
    raise exception 'analytics_invalid_date_range' using errcode = '22023';
  end if;
  days_count := (end_date - start_date) + 1;
  if days_count > 3650 then
    raise exception 'analytics_date_range_too_large' using errcode = '22023';
  end if;

  return query
  with ranked as (
    select
      ps.player_id,
      ps.verified_runs_count,
      ps.best_score,
      ps.best_score_at,
      ps.tracked_play_ticks,
      row_number() over (
        order by ps.best_score desc, ps.best_score_at asc nulls last, ps.player_id asc
      ) as global_rank
    from public.player_stats as ps
    where ps.verified_runs_count > 0
  ),
  period as (
    select
      pad.player_id,
      sum(pad.verified_runs)::bigint as period_verified_runs,
      sum(pad.score_sum)::bigint as period_total_score,
      max(pad.best_score)::integer as period_best_score,
      sum(pad.play_ticks)::bigint as period_play_ticks,
      count(*)::bigint as period_active_days,
      min(pad.first_run_at) as period_first_run_at,
      max(pad.last_run_at) as period_last_run_at
    from public.player_activity_daily as pad
    where pad.activity_date between start_date and end_date
    group by pad.player_id
  ),
  pending as (
    select vr.player_id, count(*)::bigint as pending_issued
    from public.verified_runs as vr
    where vr.status = 'issued'
    group by vr.player_id
  ),
  rows as (
    select
      r.global_rank,
      r.player_id,
      p.username,
      p.display_name,
      p.avatar_url,
      pr.period_verified_runs,
      pr.period_total_score,
      case
        when pr.period_verified_runs > 0 then pr.period_total_score::numeric / pr.period_verified_runs::numeric
        else null
      end as period_average_score,
      pr.period_best_score,
      pr.period_play_ticks,
      pr.period_active_days,
      pr.period_first_run_at,
      pr.period_last_run_at,
      r.verified_runs_count as lifetime_verified_runs,
      r.best_score as lifetime_best_score,
      r.tracked_play_ticks,
      coalesce(pn.pending_issued, 0)::bigint as pending_issued
    from period as pr
    join ranked as r on r.player_id = pr.player_id
    left join public.profiles as p on p.id = pr.player_id
    left join pending as pn on pn.player_id = pr.player_id
    where query_text is null
      or coalesce(p.username, '') ilike '%' || query_text || '%'
      or coalesce(p.display_name, '') ilike '%' || query_text || '%'
      or pr.player_id::text ilike '%' || query_text || '%'
  )
  select
    x.global_rank,
    x.player_id,
    x.username,
    x.display_name,
    x.avatar_url,
    x.period_verified_runs,
    x.period_total_score,
    x.period_average_score,
    x.period_best_score,
    x.period_play_ticks,
    x.period_active_days,
    x.period_first_run_at,
    x.period_last_run_at,
    x.lifetime_verified_runs,
    x.lifetime_best_score,
    x.tracked_play_ticks,
    x.pending_issued
  from rows as x
  order by
    case when ordering = 'record' then x.period_best_score end desc nulls last,
    case when ordering = 'playtime' then x.period_play_ticks end desc nulls last,
    case when ordering = 'recent' then x.period_last_run_at end desc nulls last,
    case when ordering = 'active_days' then x.period_active_days end desc nulls last,
    case when ordering = 'runs' then x.period_verified_runs end desc nulls last,
    x.period_best_score desc,
    x.global_rank asc
  limit row_limit
  offset row_offset;
end;
$$;

revoke all on function public.admin_analytics_players_range(date, date, integer, integer, text, text) from public, anon;
grant execute on function public.admin_analytics_players_range(date, date, integer, integer, text, text) to authenticated, service_role;

create or replace function public.admin_analytics_retention_range(
  date_from date default null,
  date_to date default null
)
returns table (
  cohort_date date,
  cohort_size bigint,
  d0_active bigint,
  d1_active bigint,
  d7_active bigint,
  d30_active bigint,
  d0_pct numeric,
  d1_pct numeric,
  d7_pct numeric,
  d30_pct numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  utc_today date := (statement_timestamp() at time zone 'UTC')::date;
  end_date date := least(coalesce(date_to, utc_today), utc_today);
  requested_start date := coalesce(date_from, least(coalesce(date_to, utc_today), utc_today) - 89);
  tracking_date date;
  start_date date;
  days_count integer;
begin
  perform public.require_analytics_admin();

  if requested_start > end_date then
    raise exception 'analytics_invalid_date_range' using errcode = '22023';
  end if;
  days_count := (end_date - requested_start) + 1;
  if days_count > 3650 then
    raise exception 'analytics_date_range_too_large' using errcode = '22023';
  end if;

  select (am.tracking_started_at at time zone 'UTC')::date
  into tracking_date
  from public.analytics_meta as am
  where am.singleton = 1;

  start_date := greatest(tracking_date, requested_start);

  return query
  with cohort_players as (
    select
      p.id as player_id,
      (p.created_at at time zone 'UTC')::date as cohort_date
    from public.profiles as p
    where (p.created_at at time zone 'UTC')::date between start_date and end_date
  ),
  cohort_agg as (
    select
      cp.cohort_date,
      count(*)::bigint as cohort_size,
      count(*) filter (
        where exists (
          select 1 from public.player_activity_daily as pad
          where pad.player_id = cp.player_id and pad.activity_date = cp.cohort_date
        )
      )::bigint as d0_active,
      count(*) filter (
        where exists (
          select 1 from public.player_activity_daily as pad
          where pad.player_id = cp.player_id and pad.activity_date = cp.cohort_date + 1
        )
      )::bigint as d1_active,
      count(*) filter (
        where exists (
          select 1 from public.player_activity_daily as pad
          where pad.player_id = cp.player_id and pad.activity_date = cp.cohort_date + 7
        )
      )::bigint as d7_active,
      count(*) filter (
        where exists (
          select 1 from public.player_activity_daily as pad
          where pad.player_id = cp.player_id and pad.activity_date = cp.cohort_date + 30
        )
      )::bigint as d30_active
    from cohort_players as cp
    group by cp.cohort_date
  )
  select
    ca.cohort_date,
    ca.cohort_size,
    ca.d0_active,
    ca.d1_active,
    ca.d7_active,
    ca.d30_active,
    case when ca.cohort_size > 0 then ca.d0_active::numeric * 100 / ca.cohort_size else null end,
    case when ca.cohort_date <= utc_today - 1 and ca.cohort_size > 0 then ca.d1_active::numeric * 100 / ca.cohort_size else null end,
    case when ca.cohort_date <= utc_today - 7 and ca.cohort_size > 0 then ca.d7_active::numeric * 100 / ca.cohort_size else null end,
    case when ca.cohort_date <= utc_today - 30 and ca.cohort_size > 0 then ca.d30_active::numeric * 100 / ca.cohort_size else null end
  from cohort_agg as ca
  order by ca.cohort_date desc;
end;
$$;

revoke all on function public.admin_analytics_retention_range(date, date) from public, anon;
grant execute on function public.admin_analytics_retention_range(date, date) to authenticated, service_role;

comment on function public.admin_analytics_overview_range(date, date) is
  'Admin-only overview for an inclusive UTC date range, including historical audience as of the selected end date.';
comment on function public.admin_analytics_daily_range(date, date) is
  'Admin-only UTC daily series for an explicit inclusive date range.';
comment on function public.admin_analytics_players_range(date, date, integer, integer, text, text) is
  'Admin-only per-player activity aggregated over an explicit UTC date range, plus lifetime rank/record context.';
comment on function public.admin_analytics_retention_range(date, date) is
  'Admin-only signup cohorts whose cohort dates fall in the selected UTC date range.';

notify pgrst, 'reload schema';
