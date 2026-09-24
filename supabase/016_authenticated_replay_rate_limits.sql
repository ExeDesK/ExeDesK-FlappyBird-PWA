-- Flappy13 v0.2.7.7b-hotfix4 - authenticated replay + read RPC rate limits.
-- Run after 015_replay_rpc_perf.sql. Safe to run more than once.
--
-- The public leaderboard remains readable without an account. Sensitive replay
-- inputs (seed/taps) are authenticated-only, and live authenticated refreshes
-- use a separate rate-limited RPC. The public initial leaderboard RPC stays
-- available for the signed-out read-only experience.

create table if not exists public.read_rpc_rate_limits (
  player_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null default now(),
  primary key (player_id, bucket),
  constraint read_rpc_rate_limits_bucket_valid
    check (bucket in ('leaderboard_refresh', 'leaderboard_replay')),
  constraint read_rpc_rate_limits_request_count_positive
    check (request_count >= 1)
);

alter table public.read_rpc_rate_limits enable row level security;
revoke all on table public.read_rpc_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.read_rpc_rate_limits to service_role;

comment on table public.read_rpc_rate_limits is
  'Server-only fixed-window counters for authenticated leaderboard refresh and replay payload RPCs. At most two rows are kept per player.';

create or replace function public.consume_read_rpc_rate_limit(
  target_bucket text,
  max_requests integer,
  window_seconds integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  request_now timestamptz := clock_timestamp();
  current_window timestamptz;
  current_count integer;
  retry_after integer;
begin
  if caller_id is null then
    return -1;
  end if;

  if target_bucket not in ('leaderboard_refresh', 'leaderboard_replay')
     or max_requests < 1
     or window_seconds < 1 then
    raise exception 'invalid read RPC rate-limit configuration';
  end if;

  -- Serialize concurrent requests for one player/bucket so parallel clicks or
  -- scripted requests cannot race the counter.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text || ':' || target_bucket, 7713)
  );

  select rl.window_started_at, rl.request_count
  into current_window, current_count
  from public.read_rpc_rate_limits as rl
  where rl.player_id = caller_id
    and rl.bucket = target_bucket
  for update;

  if not found then
    insert into public.read_rpc_rate_limits (
      player_id, bucket, window_started_at, request_count, updated_at
    ) values (
      caller_id, target_bucket, request_now, 1, request_now
    );
    return 0;
  end if;

  if current_window <= request_now - pg_catalog.make_interval(secs => window_seconds) then
    update public.read_rpc_rate_limits
    set window_started_at = request_now,
        request_count = 1,
        updated_at = request_now
    where player_id = caller_id
      and bucket = target_bucket;
    return 0;
  end if;

  if current_count >= max_requests then
    retry_after := greatest(
      1,
      ceil(extract(epoch from (
        current_window + pg_catalog.make_interval(secs => window_seconds) - request_now
      )))::integer
    );
    return retry_after;
  end if;

  update public.read_rpc_rate_limits
  set request_count = request_count + 1,
      updated_at = request_now
  where player_id = caller_id
    and bucket = target_bucket;

  return 0;
end;
$$;

revoke all on function public.consume_read_rpc_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_read_rpc_rate_limit(text, integer, integer)
  to service_role;

comment on function public.consume_read_rpc_rate_limit(text, integer, integer) is
  'Server-only atomic fixed-window rate limiter. Returns 0 when accepted, a positive retry-after value in seconds when limited, and -1 without an authenticated user.';

-- Authenticated live refresh. The public get_leaderboard() RPC remains the
-- read-only initial-load path, while explicit/forced refreshes use this RPC.
create or replace function public.get_leaderboard_refresh(limit_count integer default 100)
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
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_role text := coalesce(auth.role(), '');
  retry_after integer := 0;
begin
  if caller_role <> 'service_role' then
    if auth.uid() is null then
      raise sqlstate 'PT401' using message = 'authentication_required';
    end if;

    retry_after := public.consume_read_rpc_rate_limit(
      'leaderboard_refresh',
      6,
      60
    );

    if retry_after > 0 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object(
          'code', 'rate_limited',
          'message', 'Actualisation du classement limitée.',
          'details', pg_catalog.json_build_object('retry_after_seconds', retry_after),
          'hint', null
        )::text,
        detail = pg_catalog.json_build_object(
          'status', 429,
          'headers', pg_catalog.json_build_object('Retry-After', retry_after::text)
        )::text;
    end if;
  end if;

  return query
    select * from public.get_leaderboard(limit_count);
end;
$$;

revoke all on function public.get_leaderboard_refresh(integer) from public, anon;
grant execute on function public.get_leaderboard_refresh(integer) to authenticated, service_role;

comment on function public.get_leaderboard_refresh(integer) is
  'Authenticated live leaderboard refresh, limited to 6 requests per fixed 60-second window per player. Public initial leaderboard reads continue through get_leaderboard().';

-- Replace the replay payload RPC with an authenticated and rate-limited version.
-- The Top-100 eligibility query stays on player_stats from migration 015.
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
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_role text := coalesce(auth.role(), '');
  retry_after integer := 0;
begin
  if caller_role <> 'service_role' then
    if auth.uid() is null then
      raise sqlstate 'PT401' using message = 'authentication_required';
    end if;

    retry_after := public.consume_read_rpc_rate_limit(
      'leaderboard_replay',
      10,
      60
    );

    if retry_after > 0 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object(
          'code', 'rate_limited',
          'message', 'Chargement des replays limité.',
          'details', pg_catalog.json_build_object('retry_after_seconds', retry_after),
          'hint', null
        )::text,
        detail = pg_catalog.json_build_object(
          'status', 429,
          'headers', pg_catalog.json_build_object('Retry-After', retry_after::text)
        )::text;
    end if;
  end if;

  return query
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
end;
$$;

revoke all on function public.get_leaderboard_replay(uuid) from public, anon;
grant execute on function public.get_leaderboard_replay(uuid) to authenticated, service_role;

comment on function public.get_leaderboard_replay(uuid) is
  'Authenticated deterministic replay payload for an authoritative best run currently inside the public Top 100. Limited to 10 payload requests per 60-second window per player.';

notify pgrst, 'reload schema';
