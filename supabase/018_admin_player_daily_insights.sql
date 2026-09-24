-- Flappy13 v0.2.7.9b - player drill-down + hourly daily operations analytics.
-- Run after 017_admin_analytics_ranges.sql.
--
-- Hourly tracking starts when this migration is applied. Existing daily/lifetime
-- aggregates remain authoritative for older dates; no synthetic hourly backfill is
-- attempted because retention may already have removed detailed verified runs.

alter table public.analytics_meta
  add column if not exists hourly_tracking_started_at timestamptz;

update public.analytics_meta
set hourly_tracking_started_at = coalesce(hourly_tracking_started_at, statement_timestamp())
where singleton = 1;

create table if not exists public.player_activity_hourly (
  player_id uuid not null references auth.users(id) on delete cascade,
  activity_hour timestamptz not null,
  verified_runs integer not null default 0,
  play_ticks bigint not null default 0,
  score_sum bigint not null default 0,
  best_score integer not null default 0,
  deaths_pipe_top integer not null default 0,
  deaths_pipe_bottom integer not null default 0,
  deaths_ground integer not null default 0,
  first_run_at timestamptz,
  last_run_at timestamptz,
  primary key (player_id, activity_hour),
  constraint player_activity_hourly_hour_aligned
    check (activity_hour = date_trunc('hour', activity_hour)),
  constraint player_activity_hourly_nonnegative check (
    verified_runs >= 0
    and play_ticks >= 0
    and score_sum >= 0
    and best_score >= 0
    and deaths_pipe_top >= 0
    and deaths_pipe_bottom >= 0
    and deaths_ground >= 0
  )
);

create index if not exists player_activity_hourly_hour_idx
  on public.player_activity_hourly (activity_hour desc, player_id);

create index if not exists profiles_created_at_analytics_idx
  on public.profiles (created_at desc);

create index if not exists verified_runs_verified_resolved_at_idx
  on public.verified_runs (resolved_at desc, player_id)
  where status = 'verified';

alter table public.player_activity_hourly enable row level security;
revoke all on table public.player_activity_hourly from public, anon, authenticated;
grant select, insert, update on table public.player_activity_hourly to service_role;

comment on table public.player_activity_hourly is
  'Private per-player UTC hourly aggregates of authoritative verified gameplay. Tracking starts with migration 018; no historical hourly data is invented.';

create table if not exists public.run_metrics_hourly (
  metric_hour timestamptz primary key,
  run_start_requests bigint not null default 0,
  issued_runs bigint not null default 0,
  verified_runs bigint not null default 0,
  rejected_runs bigint not null default 0,
  expired_issued_runs bigint not null default 0,
  purged_rejected_runs bigint not null default 0,
  rate_limited_requests bigint not null default 0,
  pending_limit_requests bigint not null default 0,
  play_ticks bigint not null default 0,
  score_sum bigint not null default 0,
  best_score integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint run_metrics_hourly_hour_aligned
    check (metric_hour = date_trunc('hour', metric_hour)),
  constraint run_metrics_hourly_nonnegative check (
    run_start_requests >= 0
    and issued_runs >= 0
    and verified_runs >= 0
    and rejected_runs >= 0
    and expired_issued_runs >= 0
    and purged_rejected_runs >= 0
    and rate_limited_requests >= 0
    and pending_limit_requests >= 0
    and play_ticks >= 0
    and score_sum >= 0
    and best_score >= 0
  )
);

alter table public.run_metrics_hourly enable row level security;
revoke all on table public.run_metrics_hourly from public, anon, authenticated;
grant select, insert, update on table public.run_metrics_hourly to service_role;

comment on table public.run_metrics_hourly is
  'Private UTC hourly operational counters for the Admin day view. Tracking starts with migration 018.';

create or replace function public.bump_run_metrics_hourly(
  delta_run_start_requests bigint default 0,
  delta_issued_runs bigint default 0,
  delta_verified_runs bigint default 0,
  delta_rejected_runs bigint default 0,
  delta_expired_issued_runs bigint default 0,
  delta_purged_rejected_runs bigint default 0,
  delta_rate_limited_requests bigint default 0,
  delta_pending_limit_requests bigint default 0,
  delta_play_ticks bigint default 0,
  delta_score_sum bigint default 0,
  candidate_best_score integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_hour timestamptz := date_trunc('hour', statement_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
  insert into public.run_metrics_hourly as rmh (
    metric_hour,
    run_start_requests,
    issued_runs,
    verified_runs,
    rejected_runs,
    expired_issued_runs,
    purged_rejected_runs,
    rate_limited_requests,
    pending_limit_requests,
    play_ticks,
    score_sum,
    best_score,
    updated_at
  ) values (
    target_hour,
    greatest(coalesce(delta_run_start_requests, 0), 0),
    greatest(coalesce(delta_issued_runs, 0), 0),
    greatest(coalesce(delta_verified_runs, 0), 0),
    greatest(coalesce(delta_rejected_runs, 0), 0),
    greatest(coalesce(delta_expired_issued_runs, 0), 0),
    greatest(coalesce(delta_purged_rejected_runs, 0), 0),
    greatest(coalesce(delta_rate_limited_requests, 0), 0),
    greatest(coalesce(delta_pending_limit_requests, 0), 0),
    greatest(coalesce(delta_play_ticks, 0), 0),
    greatest(coalesce(delta_score_sum, 0), 0),
    greatest(coalesce(candidate_best_score, 0), 0),
    now()
  )
  on conflict (metric_hour) do update
  set
    run_start_requests = rmh.run_start_requests + excluded.run_start_requests,
    issued_runs = rmh.issued_runs + excluded.issued_runs,
    verified_runs = rmh.verified_runs + excluded.verified_runs,
    rejected_runs = rmh.rejected_runs + excluded.rejected_runs,
    expired_issued_runs = rmh.expired_issued_runs + excluded.expired_issued_runs,
    purged_rejected_runs = rmh.purged_rejected_runs + excluded.purged_rejected_runs,
    rate_limited_requests = rmh.rate_limited_requests + excluded.rate_limited_requests,
    pending_limit_requests = rmh.pending_limit_requests + excluded.pending_limit_requests,
    play_ticks = rmh.play_ticks + excluded.play_ticks,
    score_sum = rmh.score_sum + excluded.score_sum,
    best_score = greatest(rmh.best_score, excluded.best_score),
    updated_at = now();
end;
$$;

revoke all on function public.bump_run_metrics_hourly(
  bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, integer
) from public, anon, authenticated;

-- Preserve the daily contract from 010 while mirroring every live operational
-- increment into the UTC hourly aggregate used by the dedicated day view.
create or replace function public.bump_run_metrics(
  target_date date,
  delta_run_start_requests bigint default 0,
  delta_issued_runs bigint default 0,
  delta_verified_runs bigint default 0,
  delta_rejected_runs bigint default 0,
  delta_expired_issued_runs bigint default 0,
  delta_purged_rejected_runs bigint default 0,
  delta_rate_limited_requests bigint default 0,
  delta_pending_limit_requests bigint default 0,
  delta_play_ticks bigint default 0,
  delta_score_sum bigint default 0,
  candidate_best_score integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_date is null then
    return;
  end if;

  insert into public.run_metrics_daily as rmd (
    metric_date,
    run_start_requests,
    issued_runs,
    verified_runs,
    rejected_runs,
    expired_issued_runs,
    purged_rejected_runs,
    rate_limited_requests,
    pending_limit_requests,
    play_ticks,
    score_sum,
    best_score,
    updated_at
  ) values (
    target_date,
    greatest(coalesce(delta_run_start_requests, 0), 0),
    greatest(coalesce(delta_issued_runs, 0), 0),
    greatest(coalesce(delta_verified_runs, 0), 0),
    greatest(coalesce(delta_rejected_runs, 0), 0),
    greatest(coalesce(delta_expired_issued_runs, 0), 0),
    greatest(coalesce(delta_purged_rejected_runs, 0), 0),
    greatest(coalesce(delta_rate_limited_requests, 0), 0),
    greatest(coalesce(delta_pending_limit_requests, 0), 0),
    greatest(coalesce(delta_play_ticks, 0), 0),
    greatest(coalesce(delta_score_sum, 0), 0),
    greatest(coalesce(candidate_best_score, 0), 0),
    now()
  )
  on conflict (metric_date) do update
  set
    run_start_requests = rmd.run_start_requests + excluded.run_start_requests,
    issued_runs = rmd.issued_runs + excluded.issued_runs,
    verified_runs = rmd.verified_runs + excluded.verified_runs,
    rejected_runs = rmd.rejected_runs + excluded.rejected_runs,
    expired_issued_runs = rmd.expired_issued_runs + excluded.expired_issued_runs,
    purged_rejected_runs = rmd.purged_rejected_runs + excluded.purged_rejected_runs,
    rate_limited_requests = rmd.rate_limited_requests + excluded.rate_limited_requests,
    pending_limit_requests = rmd.pending_limit_requests + excluded.pending_limit_requests,
    play_ticks = rmd.play_ticks + excluded.play_ticks,
    score_sum = rmd.score_sum + excluded.score_sum,
    best_score = greatest(rmd.best_score, excluded.best_score),
    updated_at = now();

  perform public.bump_run_metrics_hourly(
    delta_run_start_requests,
    delta_issued_runs,
    delta_verified_runs,
    delta_rejected_runs,
    delta_expired_issued_runs,
    delta_purged_rejected_runs,
    delta_rate_limited_requests,
    delta_pending_limit_requests,
    delta_play_ticks,
    delta_score_sum,
    candidate_best_score
  );
end;
$$;

revoke all on function public.bump_run_metrics(
  date, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, integer
) from public, anon, authenticated;

-- Extend the authoritative verified-run trigger with per-player hourly activity.
-- Existing triggers remain attached to this function name.
create or replace function public.capture_verified_run_player_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_day date;
  activity_hour_utc timestamptz;
  run_ticks bigint;
begin
  if new.status <> 'verified' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'verified' then
    return new;
  end if;

  activity_day := (new.resolved_at at time zone 'UTC')::date;
  activity_hour_utc := date_trunc('hour', new.resolved_at at time zone 'UTC') at time zone 'UTC';
  run_ticks := greatest(coalesce(new.terminal_tick, 0), 0)::bigint;

  insert into public.player_stats as ps (
    player_id,
    verified_runs_count,
    total_score,
    best_score,
    best_run_id,
    best_score_at,
    first_verified_run_at,
    last_verified_run_at,
    deaths_pipe_top,
    deaths_pipe_bottom,
    deaths_ground,
    tracked_play_ticks,
    updated_at
  ) values (
    new.player_id,
    1,
    new.verified_score,
    new.verified_score,
    new.run_id,
    new.resolved_at,
    new.resolved_at,
    new.resolved_at,
    case when new.collision = 'upper-pipe' then 1 else 0 end,
    case when new.collision = 'lower-pipe' then 1 else 0 end,
    case when new.collision = 'ground' then 1 else 0 end,
    run_ticks,
    now()
  )
  on conflict (player_id) do update
  set
    verified_runs_count = ps.verified_runs_count + 1,
    total_score = ps.total_score + excluded.total_score,
    tracked_play_ticks = ps.tracked_play_ticks + excluded.tracked_play_ticks,
    first_verified_run_at = least(ps.first_verified_run_at, excluded.first_verified_run_at),
    last_verified_run_at = greatest(ps.last_verified_run_at, excluded.last_verified_run_at),
    deaths_pipe_top = ps.deaths_pipe_top + excluded.deaths_pipe_top,
    deaths_pipe_bottom = ps.deaths_pipe_bottom + excluded.deaths_pipe_bottom,
    deaths_ground = ps.deaths_ground + excluded.deaths_ground,
    best_score = case
      when excluded.best_score > ps.best_score then excluded.best_score
      when excluded.best_score = ps.best_score
        and (
          ps.best_score_at is null
          or excluded.best_score_at < ps.best_score_at
          or (
            excluded.best_score_at = ps.best_score_at
            and (ps.best_run_id is null or excluded.best_run_id < ps.best_run_id)
          )
        )
        then excluded.best_score
      else ps.best_score
    end,
    best_run_id = case
      when excluded.best_score > ps.best_score then excluded.best_run_id
      when excluded.best_score = ps.best_score
        and (
          ps.best_score_at is null
          or excluded.best_score_at < ps.best_score_at
          or (
            excluded.best_score_at = ps.best_score_at
            and (ps.best_run_id is null or excluded.best_run_id < ps.best_run_id)
          )
        )
        then excluded.best_run_id
      else ps.best_run_id
    end,
    best_score_at = case
      when excluded.best_score > ps.best_score then excluded.best_score_at
      when excluded.best_score = ps.best_score
        and (
          ps.best_score_at is null
          or excluded.best_score_at < ps.best_score_at
          or (
            excluded.best_score_at = ps.best_score_at
            and (ps.best_run_id is null or excluded.best_run_id < ps.best_run_id)
          )
        )
        then excluded.best_score_at
      else ps.best_score_at
    end,
    updated_at = now();

  insert into public.player_activity_daily as pad (
    player_id,
    activity_date,
    verified_runs,
    play_ticks,
    score_sum,
    best_score,
    first_run_at,
    last_run_at
  ) values (
    new.player_id,
    activity_day,
    1,
    run_ticks,
    new.verified_score,
    new.verified_score,
    new.resolved_at,
    new.resolved_at
  )
  on conflict (player_id, activity_date) do update
  set
    verified_runs = pad.verified_runs + 1,
    play_ticks = pad.play_ticks + excluded.play_ticks,
    score_sum = pad.score_sum + excluded.score_sum,
    best_score = greatest(pad.best_score, excluded.best_score),
    first_run_at = least(pad.first_run_at, excluded.first_run_at),
    last_run_at = greatest(pad.last_run_at, excluded.last_run_at);

  insert into public.player_activity_hourly as pah (
    player_id,
    activity_hour,
    verified_runs,
    play_ticks,
    score_sum,
    best_score,
    deaths_pipe_top,
    deaths_pipe_bottom,
    deaths_ground,
    first_run_at,
    last_run_at
  ) values (
    new.player_id,
    activity_hour_utc,
    1,
    run_ticks,
    new.verified_score,
    new.verified_score,
    case when new.collision = 'upper-pipe' then 1 else 0 end,
    case when new.collision = 'lower-pipe' then 1 else 0 end,
    case when new.collision = 'ground' then 1 else 0 end,
    new.resolved_at,
    new.resolved_at
  )
  on conflict (player_id, activity_hour) do update
  set
    verified_runs = pah.verified_runs + 1,
    play_ticks = pah.play_ticks + excluded.play_ticks,
    score_sum = pah.score_sum + excluded.score_sum,
    best_score = greatest(pah.best_score, excluded.best_score),
    deaths_pipe_top = pah.deaths_pipe_top + excluded.deaths_pipe_top,
    deaths_pipe_bottom = pah.deaths_pipe_bottom + excluded.deaths_pipe_bottom,
    deaths_ground = pah.deaths_ground + excluded.deaths_ground,
    first_run_at = least(pah.first_run_at, excluded.first_run_at),
    last_run_at = greatest(pah.last_run_at, excluded.last_run_at);

  perform public.bump_run_metrics(
    activity_day,
    delta_verified_runs => 1,
    delta_play_ticks => run_ticks,
    delta_score_sum => new.verified_score,
    candidate_best_score => new.verified_score
  );

  return new;
end;
$$;

revoke all on function public.capture_verified_run_player_stats() from public, anon, authenticated;

create or replace function public.admin_analytics_player_detail(
  target_player_id uuid,
  date_from date default null,
  date_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  utc_today date := (statement_timestamp() at time zone 'UTC')::date;
  end_date date := least(coalesce(date_to, utc_today), utc_today);
  start_date date := coalesce(date_from, least(coalesce(date_to, utc_today), utc_today) - 29);
  account_created_date date;
  result jsonb;
begin
  perform public.require_analytics_admin();

  if target_player_id is null then
    raise exception 'analytics_player_required' using errcode = '22023';
  end if;
  if start_date > end_date then
    raise exception 'analytics_invalid_date_range' using errcode = '22023';
  end if;
  if (end_date - start_date) + 1 > 3650 then
    raise exception 'analytics_date_range_too_large' using errcode = '22023';
  end if;

  select (u.created_at at time zone 'UTC')::date
  into account_created_date
  from auth.users as u
  where u.id = target_player_id;

  if account_created_date is null then
    raise exception 'analytics_player_not_found' using errcode = 'P0002';
  end if;

  with ranked as (
    select
      ps.player_id,
      row_number() over (
        order by ps.best_score desc, ps.best_score_at asc nulls last, ps.player_id asc
      ) as global_rank
    from public.player_stats as ps
    where ps.verified_runs_count > 0
  ),
  period as (
    select
      coalesce(sum(pad.verified_runs), 0)::bigint as verified_runs,
      coalesce(sum(pad.score_sum), 0)::bigint as total_score,
      coalesce(sum(pad.play_ticks), 0)::bigint as play_ticks,
      coalesce(max(pad.best_score), 0)::integer as best_score,
      count(*)::bigint as active_days,
      min(pad.first_run_at) as first_run_at,
      max(pad.last_run_at) as last_run_at
    from public.player_activity_daily as pad
    where pad.player_id = target_player_id
      and pad.activity_date between start_date and end_date
  ),
  tracked as (
    select
      coalesce(sum(pad.verified_runs), 0)::bigint as verified_runs,
      coalesce(sum(pad.play_ticks), 0)::bigint as play_ticks,
      count(*)::bigint as active_days
    from public.player_activity_daily as pad
    where pad.player_id = target_player_id
  ),
  pending as (
    select
      count(*) filter (where vr.status = 'issued')::bigint as issued,
      count(*) filter (where vr.status = 'rejected')::bigint as rejected
    from public.verified_runs as vr
    where vr.player_id = target_player_id
  ),
  identity_rows as (
    select
      i.provider,
      i.created_at,
      i.last_sign_in_at,
      coalesce(
        i.identity_data ->> 'global_name',
        i.identity_data ->> 'full_name',
        i.identity_data ->> 'name',
        i.identity_data ->> 'user_name',
        i.identity_data ->> 'preferred_username'
      ) as provider_label
    from auth.identities as i
    where i.user_id = target_player_id
    order by i.created_at asc
  ),
  recent_runs as (
    select jsonb_agg(jsonb_build_object(
      'run_id', x.run_id,
      'status', x.status,
      'score', x.verified_score,
      'collision', x.collision,
      'terminal_tick', x.terminal_tick,
      'issued_at', x.issued_at,
      'resolved_at', x.resolved_at,
      'theme', x.visual_theme,
      'variant', x.visual_variant
    ) order by coalesce(x.resolved_at, x.issued_at) desc) as rows
    from (
      select vr.*
      from public.verified_runs as vr
      where vr.player_id = target_player_id
        and vr.status in ('verified', 'rejected')
      order by coalesce(vr.resolved_at, vr.issued_at) desc
      limit 20
    ) as x
  ),
  activity as (
    select jsonb_agg(jsonb_build_object(
      'activity_date', pad.activity_date,
      'verified_runs', pad.verified_runs,
      'play_ticks', pad.play_ticks,
      'score_sum', pad.score_sum,
      'best_score', pad.best_score,
      'average_score', case when pad.verified_runs > 0 then pad.score_sum::numeric / pad.verified_runs else null end,
      'first_run_at', pad.first_run_at,
      'last_run_at', pad.last_run_at
    ) order by pad.activity_date) as rows
    from public.player_activity_daily as pad
    where pad.player_id = target_player_id
      and pad.activity_date between start_date and end_date
  ),
  retention as (
    select
      exists(select 1 from public.player_activity_daily where player_id = target_player_id and activity_date = account_created_date) as d0,
      case when account_created_date <= utc_today - 1 then exists(select 1 from public.player_activity_daily where player_id = target_player_id and activity_date = account_created_date + 1) else null end as d1,
      case when account_created_date <= utc_today - 7 then exists(select 1 from public.player_activity_daily where player_id = target_player_id and activity_date = account_created_date + 7) else null end as d7,
      case when account_created_date <= utc_today - 30 then exists(select 1 from public.player_activity_daily where player_id = target_player_id and activity_date = account_created_date + 30) else null end as d30
  )
  select jsonb_build_object(
    'selected_from', start_date,
    'selected_to', end_date,
    'profile', jsonb_build_object(
      'player_id', u.id,
      'username', p.username,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url,
      'avatar_provider', p.avatar_provider,
      'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'profile_updated_at', p.updated_at
    ),
    'identities', coalesce((select jsonb_agg(jsonb_build_object(
      'provider', ir.provider,
      'provider_label', ir.provider_label,
      'linked_at', ir.created_at,
      'last_sign_in_at', ir.last_sign_in_at
    ) order by ir.created_at) from identity_rows as ir), '[]'::jsonb),
    'lifetime', jsonb_build_object(
      'global_rank', r.global_rank,
      'verified_runs', coalesce(ps.verified_runs_count, 0),
      'total_score', coalesce(ps.total_score, 0),
      'average_score', case when coalesce(ps.verified_runs_count, 0) > 0 then ps.total_score::numeric / ps.verified_runs_count else null end,
      'best_score', ps.best_score,
      'best_run_id', ps.best_run_id,
      'best_score_at', ps.best_score_at,
      'first_verified_run_at', ps.first_verified_run_at,
      'last_verified_run_at', ps.last_verified_run_at,
      'tracked_play_ticks', coalesce(ps.tracked_play_ticks, 0),
      'tracked_verified_runs', t.verified_runs,
      'tracked_active_days', t.active_days,
      'average_run_ticks_tracked', case when t.verified_runs > 0 then t.play_ticks::numeric / t.verified_runs else null end,
      'deaths_pipe_top', coalesce(ps.deaths_pipe_top, 0),
      'deaths_pipe_bottom', coalesce(ps.deaths_pipe_bottom, 0),
      'deaths_ground', coalesce(ps.deaths_ground, 0)
    ),
    'period', jsonb_build_object(
      'verified_runs', pe.verified_runs,
      'total_score', pe.total_score,
      'average_score', case when pe.verified_runs > 0 then pe.total_score::numeric / pe.verified_runs else null end,
      'best_score', pe.best_score,
      'play_ticks', pe.play_ticks,
      'average_run_ticks', case when pe.verified_runs > 0 then pe.play_ticks::numeric / pe.verified_runs else null end,
      'active_days', pe.active_days,
      'average_play_ticks_per_active_day', case when pe.active_days > 0 then pe.play_ticks::numeric / pe.active_days else null end,
      'first_run_at', pe.first_run_at,
      'last_run_at', pe.last_run_at
    ),
    'retention', jsonb_build_object('d0', rt.d0, 'd1', rt.d1, 'd7', rt.d7, 'd30', rt.d30),
    'pending', jsonb_build_object('issued', pn.issued, 'rejected', pn.rejected),
    'activity', coalesce(a.rows, '[]'::jsonb),
    'recent_runs', coalesce(rr.rows, '[]'::jsonb)
  )
  into result
  from auth.users as u
  left join public.profiles as p on p.id = u.id
  left join public.player_stats as ps on ps.player_id = u.id
  left join ranked as r on r.player_id = u.id
  cross join period as pe
  cross join tracked as t
  cross join pending as pn
  cross join retention as rt
  cross join activity as a
  cross join recent_runs as rr
  where u.id = target_player_id;

  return result;
end;
$$;

revoke all on function public.admin_analytics_player_detail(uuid, date, date) from public, anon;
grant execute on function public.admin_analytics_player_detail(uuid, date, date) to authenticated, service_role;

create or replace function public.admin_analytics_day_overview(
  target_date date default null
)
returns table (
  selected_date date,
  tracking_started_at timestamptz,
  hourly_tracking_started_at timestamptz,
  active_players bigint,
  new_players bigint,
  new_active_players bigint,
  returning_players bigint,
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
  pending_limit_requests bigint,
  issue_rate_pct numeric,
  verification_rate_pct numeric,
  rejection_rate_pct numeric,
  first_run_at timestamptz,
  last_run_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  utc_today date := (statement_timestamp() at time zone 'UTC')::date;
  selected date := least(coalesce(target_date, utc_today), utc_today);
begin
  perform public.require_analytics_admin();

  return query
  with activity as (
    select
      count(*)::bigint as active_players,
      count(*) filter (where (p.created_at at time zone 'UTC')::date = selected)::bigint as new_active_players,
      count(*) filter (where (p.created_at at time zone 'UTC')::date < selected)::bigint as returning_players,
      coalesce(sum(pad.verified_runs), 0)::bigint as verified_runs,
      coalesce(sum(pad.play_ticks), 0)::bigint as play_ticks,
      coalesce(sum(pad.score_sum), 0)::bigint as score_sum,
      coalesce(max(pad.best_score), 0)::integer as best_score,
      min(pad.first_run_at) as first_run_at,
      max(pad.last_run_at) as last_run_at
    from public.player_activity_daily as pad
    join public.profiles as p on p.id = pad.player_id
    where pad.activity_date = selected
  ),
  profiles as (
    select count(*)::bigint as new_players
    from public.profiles as p
    where (p.created_at at time zone 'UTC')::date = selected
  ),
  metrics as (
    select
      coalesce(rmd.run_start_requests, 0)::bigint as run_start_requests,
      coalesce(rmd.issued_runs, 0)::bigint as issued_runs,
      coalesce(rmd.rejected_runs, 0)::bigint as rejected_runs,
      coalesce(rmd.expired_issued_runs, 0)::bigint as expired_issued_runs,
      coalesce(rmd.purged_rejected_runs, 0)::bigint as purged_rejected_runs,
      coalesce(rmd.rate_limited_requests, 0)::bigint as rate_limited_requests,
      coalesce(rmd.pending_limit_requests, 0)::bigint as pending_limit_requests
    from (select 1) as seed
    left join public.run_metrics_daily as rmd on rmd.metric_date = selected
  )
  select
    selected,
    am.tracking_started_at,
    am.hourly_tracking_started_at,
    a.active_players,
    pc.new_players,
    a.new_active_players,
    a.returning_players,
    a.verified_runs,
    a.play_ticks,
    a.score_sum,
    a.best_score,
    case when a.verified_runs > 0 then a.score_sum::numeric / a.verified_runs else null end,
    m.run_start_requests,
    m.issued_runs,
    m.rejected_runs,
    m.expired_issued_runs,
    m.purged_rejected_runs,
    m.rate_limited_requests,
    m.pending_limit_requests,
    case when m.run_start_requests > 0 then m.issued_runs::numeric * 100 / m.run_start_requests else null end,
    case when m.issued_runs > 0 then a.verified_runs::numeric * 100 / m.issued_runs else null end,
    case when m.issued_runs > 0 then m.rejected_runs::numeric * 100 / m.issued_runs else null end,
    a.first_run_at,
    a.last_run_at
  from public.analytics_meta as am
  cross join activity as a
  cross join profiles as pc
  cross join metrics as m
  where am.singleton = 1;
end;
$$;

revoke all on function public.admin_analytics_day_overview(date) from public, anon;
grant execute on function public.admin_analytics_day_overview(date) to authenticated, service_role;

create or replace function public.admin_analytics_day_hourly(
  target_date date default null
)
returns table (
  activity_hour timestamptz,
  hour_index integer,
  active_players bigint,
  new_players bigint,
  verified_runs bigint,
  play_ticks bigint,
  score_sum bigint,
  best_score integer,
  average_score numeric,
  deaths_pipe_top bigint,
  deaths_pipe_bottom bigint,
  deaths_ground bigint,
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
  selected date := least(coalesce(target_date, utc_today), utc_today);
  day_start timestamptz := (selected::timestamp at time zone 'UTC');
  day_end timestamptz := ((selected + 1)::timestamp at time zone 'UTC');
begin
  perform public.require_analytics_admin();

  return query
  with hours as (
    select generate_series(day_start, day_end - interval '1 hour', interval '1 hour') as activity_hour
  ),
  activity as (
    select
      pah.activity_hour,
      count(*)::bigint as active_players,
      sum(pah.verified_runs)::bigint as verified_runs,
      sum(pah.play_ticks)::bigint as play_ticks,
      sum(pah.score_sum)::bigint as score_sum,
      max(pah.best_score)::integer as best_score,
      sum(pah.deaths_pipe_top)::bigint as deaths_pipe_top,
      sum(pah.deaths_pipe_bottom)::bigint as deaths_pipe_bottom,
      sum(pah.deaths_ground)::bigint as deaths_ground
    from public.player_activity_hourly as pah
    where pah.activity_hour >= day_start and pah.activity_hour < day_end
    group by pah.activity_hour
  ),
  signups as (
    select
      date_trunc('hour', p.created_at at time zone 'UTC') at time zone 'UTC' as activity_hour,
      count(*)::bigint as new_players
    from public.profiles as p
    where p.created_at >= day_start and p.created_at < day_end
    group by 1
  )
  select
    h.activity_hour,
    extract(hour from h.activity_hour at time zone 'UTC')::integer,
    coalesce(a.active_players, 0)::bigint,
    coalesce(s.new_players, 0)::bigint,
    coalesce(a.verified_runs, 0)::bigint,
    coalesce(a.play_ticks, 0)::bigint,
    coalesce(a.score_sum, 0)::bigint,
    coalesce(a.best_score, 0)::integer,
    case when coalesce(a.verified_runs, 0) > 0 then a.score_sum::numeric / a.verified_runs else null end,
    coalesce(a.deaths_pipe_top, 0)::bigint,
    coalesce(a.deaths_pipe_bottom, 0)::bigint,
    coalesce(a.deaths_ground, 0)::bigint,
    coalesce(rmh.run_start_requests, 0)::bigint,
    coalesce(rmh.issued_runs, 0)::bigint,
    coalesce(rmh.rejected_runs, 0)::bigint,
    coalesce(rmh.expired_issued_runs, 0)::bigint,
    coalesce(rmh.purged_rejected_runs, 0)::bigint,
    coalesce(rmh.rate_limited_requests, 0)::bigint,
    coalesce(rmh.pending_limit_requests, 0)::bigint
  from hours as h
  left join activity as a on a.activity_hour = h.activity_hour
  left join signups as s on s.activity_hour = h.activity_hour
  left join public.run_metrics_hourly as rmh on rmh.metric_hour = h.activity_hour
  order by h.activity_hour;
end;
$$;

revoke all on function public.admin_analytics_day_hourly(date) from public, anon;
grant execute on function public.admin_analytics_day_hourly(date) to authenticated, service_role;

create or replace function public.admin_analytics_day_recent_runs(
  target_date date default null,
  limit_count integer default 30
)
returns table (
  run_id uuid,
  player_id uuid,
  username text,
  display_name text,
  avatar_url text,
  score integer,
  collision text,
  terminal_tick integer,
  resolved_at timestamptz,
  visual_theme text,
  visual_variant text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  utc_today date := (statement_timestamp() at time zone 'UTC')::date;
  selected date := least(coalesce(target_date, utc_today), utc_today);
  day_start timestamptz := (selected::timestamp at time zone 'UTC');
  day_end timestamptz := ((selected + 1)::timestamp at time zone 'UTC');
  row_limit integer := least(greatest(coalesce(limit_count, 30), 1), 100);
begin
  perform public.require_analytics_admin();

  return query
  select
    vr.run_id,
    vr.player_id,
    p.username,
    p.display_name,
    p.avatar_url,
    vr.verified_score,
    vr.collision,
    vr.terminal_tick,
    vr.resolved_at,
    vr.visual_theme,
    vr.visual_variant
  from public.verified_runs as vr
  left join public.profiles as p on p.id = vr.player_id
  where vr.status = 'verified'
    and vr.resolved_at >= day_start
    and vr.resolved_at < day_end
  order by vr.resolved_at desc
  limit row_limit;
end;
$$;

revoke all on function public.admin_analytics_day_recent_runs(date, integer) from public, anon;
grant execute on function public.admin_analytics_day_recent_runs(date, integer) to authenticated, service_role;

comment on function public.admin_analytics_player_detail(uuid, date, date) is
  'Admin-only player drill-down: linked OAuth providers, lifetime/period stats, daily activity, retention and retained recent run summaries. Never returns provider tokens or replay seed/taps.';
comment on function public.admin_analytics_day_overview(date) is
  'Admin-only exact UTC day summary from durable daily aggregates, even for days before hourly tracking started.';
comment on function public.admin_analytics_day_hourly(date) is
  'Admin-only 24-hour UTC series. Hourly gameplay/operations exist only from migration 018 onward; signup buckets come from profiles.';
comment on function public.admin_analytics_day_recent_runs(date, integer) is
  'Admin-only recent retained verified run summaries for one UTC day. Retention means this is an inspection list, not an authoritative full-day counter.';

notify pgrst, 'reload schema';
