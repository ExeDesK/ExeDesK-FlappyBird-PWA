-- Flappy13 v0.2.7.4b - private administration analytics.
-- Run after 009_verified_run_ticket_hygiene.sql.
--
-- Design goals:
--   * preserve lifetime counters even though detailed verified runs are retained only 50 + record;
--   * collect daily activity/operational aggregates from this migration onward;
--   * expose analytics only through authenticated admin RPCs;
--   * never expose service_role credentials to the browser;
--   * keep the existing verified-run protocol and Edge Function signatures unchanged.
--
-- Historical note:
--   play-time and retention tracking start when this migration is first applied.
--   Old detailed runs may already have been removed by retention, so this migration
--   deliberately does not invent/backfill historical play-time or daily cohorts.

create table if not exists public.analytics_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

alter table public.analytics_admins enable row level security;
revoke all on table public.analytics_admins from public, anon, authenticated;
grant select, insert, update, delete on table public.analytics_admins to service_role;

comment on table public.analytics_admins is
  'Private allow-list for the administration analytics dashboard. Browser roles never read this table directly.';

create table if not exists public.analytics_meta (
  singleton smallint primary key default 1,
  tracking_started_at timestamptz not null default now(),
  constraint analytics_meta_singleton check (singleton = 1)
);

insert into public.analytics_meta (singleton)
values (1)
on conflict (singleton) do nothing;

alter table public.analytics_meta enable row level security;
revoke all on table public.analytics_meta from public, anon, authenticated;
grant select on table public.analytics_meta to service_role;

create table if not exists public.player_activity_daily (
  player_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null,
  verified_runs integer not null default 0,
  play_ticks bigint not null default 0,
  score_sum bigint not null default 0,
  best_score integer not null default 0,
  first_run_at timestamptz,
  last_run_at timestamptz,
  primary key (player_id, activity_date),

  constraint player_activity_daily_runs_nonnegative check (verified_runs >= 0),
  constraint player_activity_daily_ticks_nonnegative check (play_ticks >= 0),
  constraint player_activity_daily_score_sum_nonnegative check (score_sum >= 0),
  constraint player_activity_daily_best_score_nonnegative check (best_score >= 0)
);

create index if not exists player_activity_daily_date_idx
  on public.player_activity_daily (activity_date desc, player_id);

alter table public.player_activity_daily enable row level security;
revoke all on table public.player_activity_daily from public, anon, authenticated;
grant select, insert, update on table public.player_activity_daily to service_role;

comment on table public.player_activity_daily is
  'Private daily aggregates of authoritative verified gameplay, collected from analytics tracking start onward.';

create table if not exists public.run_metrics_daily (
  metric_date date primary key,
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

  constraint run_metrics_daily_nonnegative check (
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

alter table public.run_metrics_daily enable row level security;
revoke all on table public.run_metrics_daily from public, anon, authenticated;
grant select, insert, update on table public.run_metrics_daily to service_role;

comment on table public.run_metrics_daily is
  'Private operational counters for run-start, verification, rejection, expiry and rate-limit events.';

alter table public.player_stats
  add column if not exists tracked_play_ticks bigint not null default 0;

alter table public.player_stats
  drop constraint if exists player_stats_tracked_play_ticks_nonnegative;
alter table public.player_stats
  add constraint player_stats_tracked_play_ticks_nonnegative
  check (tracked_play_ticks >= 0);

comment on column public.player_stats.tracked_play_ticks is
  'Authoritative verified gameplay ticks accumulated from analytics tracking start onward; intentionally not backfilled from retention-pruned history.';

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
end;
$$;

revoke all on function public.bump_run_metrics(
  date, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, integer
) from public, anon, authenticated;

-- Replace the existing authoritative player-stats trigger function. The existing
-- triggers from 005 remain attached to this function name and therefore pick up
-- the new activity/play-time collection automatically.
create or replace function public.capture_verified_run_player_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_day date;
  run_ticks bigint;
begin
  if new.status <> 'verified' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'verified' then
    return new;
  end if;

  activity_day := (new.resolved_at at time zone 'UTC')::date;
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
  )
  values (
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

create or replace function public.capture_rejected_run_analytics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'rejected' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'rejected' then
    return new;
  end if;

  perform public.bump_run_metrics(
    (new.resolved_at at time zone 'UTC')::date,
    delta_rejected_runs => 1
  );

  return new;
end;
$$;

revoke all on function public.capture_rejected_run_analytics() from public, anon, authenticated;

drop trigger if exists analytics_on_rejected_run_insert on public.verified_runs;
create trigger analytics_on_rejected_run_insert
after insert on public.verified_runs
for each row
when (new.status = 'rejected')
execute procedure public.capture_rejected_run_analytics();

drop trigger if exists analytics_on_rejected_run_update on public.verified_runs;
create trigger analytics_on_rejected_run_update
after update of status on public.verified_runs
for each row
when (new.status = 'rejected' and old.status is distinct from 'rejected')
execute procedure public.capture_rejected_run_analytics();

-- Extend 009 cleanup with durable aggregate counters before old ticket rows are
-- discarded. The function signature remains identical, so the existing cron job
-- continues to call it without modification.
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
  cleanup_day date := (statement_timestamp() at time zone 'UTC')::date;
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

  if issued_count > 0 or rejected_count > 0 then
    perform public.bump_run_metrics(
      cleanup_day,
      delta_expired_issued_runs => issued_count,
      delta_purged_rejected_runs => rejected_count
    );
  end if;

  return query select issued_count, rejected_count;
end;
$$;

revoke all on function public.cleanup_stale_verified_run_tickets()
  from public, anon, authenticated;
grant execute on function public.cleanup_stale_verified_run_tickets()
  to service_role;

-- Extend 009 run issuance with durable request/rate-limit counters. Signature
-- and result shape stay unchanged for the already deployed run-start function.
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
  issue_day date := (statement_timestamp() at time zone 'UTC')::date;
  open_issued integer := 0;
  expired_for_player integer := 0;
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_player_id::text, 636)
  );

  perform public.bump_run_metrics(issue_day, delta_run_start_requests => 1);

  with deleted as (
    delete from public.verified_runs as vr
    where vr.player_id = target_player_id
      and vr.status = 'issued'
      and vr.issued_at < issue_now - interval '7 days'
    returning 1
  )
  select count(*)::integer
  into expired_for_player
  from deleted;

  if expired_for_player > 0 then
    perform public.bump_run_metrics(
      issue_day,
      delta_expired_issued_runs => expired_for_player
    );
  end if;

  select count(*)::integer
  into open_issued
  from public.verified_runs as vr
  where vr.player_id = target_player_id
    and vr.status = 'issued';

  if open_issued >= 10 then
    perform public.bump_run_metrics(issue_day, delta_pending_limit_requests => 1);

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

    perform public.bump_run_metrics(issue_day, delta_rate_limited_requests => 1);

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

  perform public.bump_run_metrics(issue_day, delta_issued_runs => 1);

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

create or replace function public.is_analytics_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.analytics_admins as aa
      where aa.user_id = auth.uid()
    );
$$;

revoke all on function public.is_analytics_admin() from public, anon;
grant execute on function public.is_analytics_admin() to authenticated, service_role;

create or replace function public.require_analytics_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_analytics_admin() then
    raise exception 'analytics_admin_required'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.require_analytics_admin() from public, anon, authenticated;

create or replace function public.admin_analytics_overview(window_days integer default 30)
returns table (
  tracking_started_at timestamptz,
  selected_days integer,
  total_players bigint,
  players_with_verified_runs bigint,
  active_players bigint,
  dau bigint,
  wau bigint,
  mau bigint,
  new_players bigint,
  lifetime_verified_runs bigint,
  window_verified_runs bigint,
  tracked_play_ticks_total bigint,
  window_play_ticks bigint,
  global_best_score integer,
  lifetime_average_score numeric,
  window_average_score numeric,
  pending_issued bigint,
  retained_rejected bigint,
  run_start_requests bigint,
  issued_runs bigint,
  rejected_runs bigint,
  expired_issued_runs bigint,
  purged_rejected_runs bigint,
  rate_limited_requests bigint,
  pending_limit_requests bigint,
  verification_rate_pct numeric,
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
  days_count integer := least(greatest(coalesce(window_days, 30), 1), 3650);
  start_date date := current_date - (days_count - 1);
begin
  perform public.require_analytics_admin();

  return query
  with activity as (
    select
      count(distinct pad.player_id)::bigint as active_players,
      coalesce(sum(pad.verified_runs), 0)::bigint as verified_runs,
      coalesce(sum(pad.play_ticks), 0)::bigint as play_ticks,
      coalesce(sum(pad.score_sum), 0)::bigint as score_sum
    from public.player_activity_daily as pad
    where pad.activity_date >= start_date
  ),
  audience as (
    select
      count(distinct pad.player_id) filter (where pad.activity_date = current_date)::bigint as dau,
      count(distinct pad.player_id) filter (where pad.activity_date >= current_date - 6)::bigint as wau,
      count(distinct pad.player_id) filter (where pad.activity_date >= current_date - 29)::bigint as mau
    from public.player_activity_daily as pad
    where pad.activity_date >= current_date - 29
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
    where rmd.metric_date >= start_date
  )
  select
    am.tracking_started_at,
    days_count,
    (select count(*)::bigint from public.profiles),
    s.players_with_runs,
    a.active_players,
    au.dau,
    au.wau,
    au.mau,
    (
      select count(*)::bigint
      from public.profiles as p
      where (p.created_at at time zone 'UTC')::date >= start_date
    ),
    s.lifetime_runs,
    a.verified_runs,
    s.tracked_ticks,
    a.play_ticks,
    s.global_best,
    case
      when s.lifetime_runs > 0 then s.lifetime_score::numeric / s.lifetime_runs::numeric
      else null
    end,
    case
      when a.verified_runs > 0 then a.score_sum::numeric / a.verified_runs::numeric
      else null
    end,
    (
      select count(*)::bigint from public.verified_runs as vr where vr.status = 'issued'
    ),
    (
      select count(*)::bigint from public.verified_runs as vr where vr.status = 'rejected'
    ),
    m.run_start_requests,
    m.issued_runs,
    m.rejected_runs,
    m.expired_issued_runs,
    m.purged_rejected_runs,
    m.rate_limited_requests,
    m.pending_limit_requests,
    case
      when m.issued_runs > 0 then (a.verified_runs::numeric / m.issued_runs::numeric) * 100
      else null
    end,
    s.top_deaths,
    s.bottom_deaths,
    s.ground_deaths
  from public.analytics_meta as am
  cross join activity as a
  cross join audience as au
  cross join stats as s
  cross join metrics as m
  where am.singleton = 1;
end;
$$;

revoke all on function public.admin_analytics_overview(integer) from public, anon;
grant execute on function public.admin_analytics_overview(integer) to authenticated, service_role;

create or replace function public.admin_analytics_daily(window_days integer default 30)
returns table (
  activity_date date,
  active_players bigint,
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
  days_count integer := least(greatest(coalesce(window_days, 30), 1), 3650);
  start_date date := current_date - (days_count - 1);
begin
  perform public.require_analytics_admin();

  return query
  with dates as (
    select generate_series(start_date, current_date, interval '1 day')::date as activity_date
  ),
  activity as (
    select
      pad.activity_date,
      count(distinct pad.player_id)::bigint as active_players,
      sum(pad.verified_runs)::bigint as verified_runs,
      sum(pad.play_ticks)::bigint as play_ticks,
      sum(pad.score_sum)::bigint as score_sum,
      max(pad.best_score)::integer as best_score
    from public.player_activity_daily as pad
    where pad.activity_date >= start_date
    group by pad.activity_date
  ),
  profiles as (
    select
      (p.created_at at time zone 'UTC')::date as activity_date,
      count(*)::bigint as new_players
    from public.profiles as p
    where (p.created_at at time zone 'UTC')::date >= start_date
    group by (p.created_at at time zone 'UTC')::date
  )
  select
    d.activity_date,
    coalesce(a.active_players, 0)::bigint,
    coalesce(a.active_players, 0)::bigint as dau,
    coalesce(audience.wau, 0)::bigint as wau,
    coalesce(audience.mau, 0)::bigint as mau,
    coalesce(p.new_players, 0)::bigint,
    coalesce(a.verified_runs, 0)::bigint,
    coalesce(a.play_ticks, 0)::bigint,
    coalesce(a.score_sum, 0)::bigint,
    coalesce(a.best_score, 0)::integer,
    case
      when coalesce(a.verified_runs, 0) > 0
        then a.score_sum::numeric / a.verified_runs::numeric
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

revoke all on function public.admin_analytics_daily(integer) from public, anon;
grant execute on function public.admin_analytics_daily(integer) to authenticated, service_role;

create or replace function public.admin_analytics_players(
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
  verified_runs_count bigint,
  total_score bigint,
  average_score numeric,
  best_score integer,
  best_score_at timestamptz,
  tracked_play_ticks bigint,
  first_verified_run_at timestamptz,
  last_verified_run_at timestamptz,
  deaths_pipe_top bigint,
  deaths_pipe_bottom bigint,
  deaths_ground bigint,
  pending_issued bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  row_limit integer := least(greatest(coalesce(limit_count, 100), 1), 500);
  row_offset integer := greatest(coalesce(offset_count, 0), 0);
  query_text text := nullif(btrim(coalesce(search_query, '')), '');
  ordering text := case
    when sort_key in ('record', 'playtime', 'recent', 'runs') then sort_key
    else 'runs'
  end;
begin
  perform public.require_analytics_admin();

  return query
  with ranked as (
    select
      ps.*,
      row_number() over (
        order by ps.best_score desc, ps.best_score_at asc nulls last, ps.player_id asc
      ) as global_rank
    from public.player_stats as ps
    where ps.verified_runs_count > 0
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
      r.verified_runs_count,
      r.total_score,
      case
        when r.verified_runs_count > 0 then r.total_score::numeric / r.verified_runs_count::numeric
        else null
      end as average_score,
      r.best_score,
      r.best_score_at,
      r.tracked_play_ticks,
      r.first_verified_run_at,
      r.last_verified_run_at,
      r.deaths_pipe_top,
      r.deaths_pipe_bottom,
      r.deaths_ground,
      coalesce(pn.pending_issued, 0)::bigint as pending_issued
    from ranked as r
    left join public.profiles as p on p.id = r.player_id
    left join pending as pn on pn.player_id = r.player_id
    where query_text is null
      or coalesce(p.username, '') ilike '%' || query_text || '%'
      or coalesce(p.display_name, '') ilike '%' || query_text || '%'
      or r.player_id::text ilike '%' || query_text || '%'
  )
  select
    x.global_rank,
    x.player_id,
    x.username,
    x.display_name,
    x.avatar_url,
    x.verified_runs_count,
    x.total_score,
    x.average_score,
    x.best_score,
    x.best_score_at,
    x.tracked_play_ticks,
    x.first_verified_run_at,
    x.last_verified_run_at,
    x.deaths_pipe_top,
    x.deaths_pipe_bottom,
    x.deaths_ground,
    x.pending_issued
  from rows as x
  order by
    case when ordering = 'record' then x.best_score end desc nulls last,
    case when ordering = 'playtime' then x.tracked_play_ticks end desc nulls last,
    case when ordering = 'recent' then x.last_verified_run_at end desc nulls last,
    case when ordering = 'runs' then x.verified_runs_count end desc nulls last,
    x.best_score desc,
    x.global_rank asc
  limit row_limit
  offset row_offset;
end;
$$;

revoke all on function public.admin_analytics_players(integer, integer, text, text) from public, anon;
grant execute on function public.admin_analytics_players(integer, integer, text, text) to authenticated, service_role;

create or replace function public.admin_analytics_retention(cohort_days integer default 90)
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
  days_count integer := least(greatest(coalesce(cohort_days, 90), 1), 3650);
  tracking_date date;
  start_date date;
begin
  perform public.require_analytics_admin();

  select (am.tracking_started_at at time zone 'UTC')::date
  into tracking_date
  from public.analytics_meta as am
  where am.singleton = 1;

  start_date := greatest(tracking_date, current_date - (days_count - 1));

  return query
  with cohort_players as (
    select
      p.id as player_id,
      (p.created_at at time zone 'UTC')::date as cohort_date
    from public.profiles as p
    where (p.created_at at time zone 'UTC')::date >= start_date
  ),
  cohort_agg as (
    select
      cp.cohort_date,
      count(*)::bigint as cohort_size,
      count(*) filter (
        where exists (
          select 1 from public.player_activity_daily as pad
          where pad.player_id = cp.player_id
            and pad.activity_date = cp.cohort_date
        )
      )::bigint as d0_active,
      count(*) filter (
        where exists (
          select 1 from public.player_activity_daily as pad
          where pad.player_id = cp.player_id
            and pad.activity_date = cp.cohort_date + 1
        )
      )::bigint as d1_active,
      count(*) filter (
        where exists (
          select 1 from public.player_activity_daily as pad
          where pad.player_id = cp.player_id
            and pad.activity_date = cp.cohort_date + 7
        )
      )::bigint as d7_active,
      count(*) filter (
        where exists (
          select 1 from public.player_activity_daily as pad
          where pad.player_id = cp.player_id
            and pad.activity_date = cp.cohort_date + 30
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
    case
      when ca.cohort_date <= current_date - 1 and ca.cohort_size > 0
        then ca.d1_active::numeric * 100 / ca.cohort_size
      else null
    end,
    case
      when ca.cohort_date <= current_date - 7 and ca.cohort_size > 0
        then ca.d7_active::numeric * 100 / ca.cohort_size
      else null
    end,
    case
      when ca.cohort_date <= current_date - 30 and ca.cohort_size > 0
        then ca.d30_active::numeric * 100 / ca.cohort_size
      else null
    end
  from cohort_agg as ca
  order by ca.cohort_date desc;
end;
$$;

revoke all on function public.admin_analytics_retention(integer) from public, anon;
grant execute on function public.admin_analytics_retention(integer) to authenticated, service_role;

comment on function public.is_analytics_admin() is
  'Authenticated allow-list check for the private analytics dashboard.';
comment on function public.admin_analytics_overview(integer) is
  'Admin-only KPI overview. Lifetime scores/runs remain authoritative; play-time and daily analytics start at migration 010.';
comment on function public.admin_analytics_daily(integer) is
  'Admin-only UTC daily activity and verified-run lifecycle series.';
comment on function public.admin_analytics_players(integer, integer, text, text) is
  'Admin-only player table with lifetime authoritative stats and analytics-era play-time.';
comment on function public.admin_analytics_retention(integer) is
  'Admin-only signup cohort retention based on authoritative verified activity; cohorts begin at analytics tracking start.';

notify pgrst, 'reload schema';
