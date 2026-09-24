-- Flappy13 v0.2.8b-hotfix2 - fix PL/pgSQL ambiguity in hourly player analytics.
-- Run after 020_record_tenure_resilience.sql.
--
-- Migration 018 declared a local variable named activity_hour while also using
-- activity_hour as the conflict-target column of player_activity_hourly. PostgreSQL
-- therefore raised SQLSTATE 42702 during verified-run resolution. Rename only the
-- local variable; no data or public RPC contract changes.

begin;

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

notify pgrst, 'reload schema';

commit;
