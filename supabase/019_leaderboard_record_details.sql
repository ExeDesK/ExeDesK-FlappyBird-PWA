-- Flappy13 v0.2.8b - leaderboard record details and continuous #1 tenure.
-- Run after 018_admin_player_daily_insights.sql. Safe to run more than once.
--
-- best_score_at already gives the authoritative date/time of every player's
-- current record. The singleton state below adds one piece that cannot be
-- reconstructed from best_score_at alone: when the current #1 first took the
-- lead continuously. If the same leader improves their own score, held_since
-- intentionally stays unchanged.

begin;

create table if not exists public.leaderboard_record_state (
  singleton boolean primary key default true check (singleton),
  player_id uuid not null,
  run_id uuid not null,
  score integer not null check (score >= 0),
  held_since timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.leaderboard_record_state enable row level security;
revoke all on table public.leaderboard_record_state from public, anon, authenticated;
grant select on table public.leaderboard_record_state to service_role;

comment on table public.leaderboard_record_state is
  'Server-owned singleton tracking the current global #1 and the start of their uninterrupted record-holder tenure.';
comment on column public.leaderboard_record_state.held_since is
  'Start of the current player uninterrupted tenure at global rank #1. Improving the same leader score does not reset it.';

create or replace function public.sync_leaderboard_record_state(candidate_since timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  top_player_id uuid;
  top_run_id uuid;
  top_score integer;
  top_score_at timestamptz;
  current_player_id uuid;
begin
  -- One tiny global critical section is enough: only verified-score changes or
  -- account deletion can affect the unique #1 holder.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('flappy13:leaderboard-record-state', 0)
  );

  select
    ps.player_id,
    ps.best_run_id,
    ps.best_score,
    ps.best_score_at
  into
    top_player_id,
    top_run_id,
    top_score,
    top_score_at
  from public.player_stats as ps
  where ps.best_run_id is not null
    and ps.best_score_at is not null
  order by
    ps.best_score desc,
    ps.best_score_at asc,
    ps.player_id asc
  limit 1;

  if top_player_id is null then
    delete from public.leaderboard_record_state where singleton = true;
    return;
  end if;

  select rs.player_id
  into current_player_id
  from public.leaderboard_record_state as rs
  where rs.singleton = true;

  if found and current_player_id = top_player_id then
    -- Same leader: a new personal/world record updates the displayed score/run,
    -- but does not reset how long this player has continuously held #1.
    update public.leaderboard_record_state
    set run_id = top_run_id,
        score = top_score,
        updated_at = now()
    where singleton = true;
    return;
  end if;

  insert into public.leaderboard_record_state (
    singleton,
    player_id,
    run_id,
    score,
    held_since,
    updated_at
  ) values (
    true,
    top_player_id,
    top_run_id,
    top_score,
    coalesce(candidate_since, top_score_at, statement_timestamp()),
    now()
  )
  on conflict (singleton) do update
  set player_id = excluded.player_id,
      run_id = excluded.run_id,
      score = excluded.score,
      held_since = excluded.held_since,
      updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.sync_leaderboard_record_state(timestamptz)
  from public, anon, authenticated;
grant execute on function public.sync_leaderboard_record_state(timestamptz)
  to service_role;

create or replace function public.capture_leaderboard_record_state_from_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- If the current leader account disappears, the next surviving #1 starts
    -- holding the record at the deletion transaction time, not at their older
    -- personal-best timestamp.
    perform public.sync_leaderboard_record_state(statement_timestamp());
    return old;
  end if;

  perform public.sync_leaderboard_record_state(new.best_score_at);
  return new;
end;
$$;

revoke all on function public.capture_leaderboard_record_state_from_stats()
  from public, anon, authenticated;

drop trigger if exists leaderboard_record_state_on_stats_insert on public.player_stats;
create trigger leaderboard_record_state_on_stats_insert
after insert on public.player_stats
for each row
execute procedure public.capture_leaderboard_record_state_from_stats();

drop trigger if exists leaderboard_record_state_on_stats_update on public.player_stats;
create trigger leaderboard_record_state_on_stats_update
after update of best_score, best_run_id, best_score_at on public.player_stats
for each row
execute procedure public.capture_leaderboard_record_state_from_stats();

drop trigger if exists leaderboard_record_state_on_stats_delete on public.player_stats;
create trigger leaderboard_record_state_on_stats_delete
after delete on public.player_stats
for each row
execute procedure public.capture_leaderboard_record_state_from_stats();

-- Backfill the currently known leader. Historical player_stats cannot prove an
-- earlier uninterrupted tenure if that same player had already been #1 and then
-- improved their own record before this migration, so the conservative initial
-- value is their current best_score_at. From this migration forward the tenure
-- is exact and survives self-improvements without resetting.
select public.sync_leaderboard_record_state(null);

-- Return shape gains record_held_since, so PostgreSQL requires drop/recreate.
-- Drop the wrapper first because it calls get_leaderboard().
drop function if exists public.get_leaderboard_refresh(integer);
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
  achieved_at timestamptz,
  record_held_since timestamptz
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
  ),
  ranked as (
    select
      row_number() over (
        order by tp.score desc, tp.achieved_at asc, tp.player_id asc
      ) as rank,
      tp.run_id,
      tp.player_id,
      tp.score,
      tp.achieved_at
    from top_players as tp
  )
  select
    r.rank,
    r.run_id,
    r.player_id,
    p.username,
    p.display_name,
    p.avatar_url,
    r.score,
    r.achieved_at,
    case
      when r.rank = 1 and rs.player_id = r.player_id then rs.held_since
      else null
    end as record_held_since
  from ranked as r
  left join public.profiles as p on p.id = r.player_id
  left join public.leaderboard_record_state as rs on rs.singleton = true
  order by r.rank asc;
$$;

revoke all on function public.get_leaderboard(integer) from public;
grant execute on function public.get_leaderboard(integer) to anon, authenticated, service_role;

comment on function public.get_leaderboard(integer) is
  'Public top-100 leaderboard from authoritative player_stats. achieved_at is each current personal record timestamp; record_held_since is populated only for the current global #1 continuous tenure.';

create function public.get_leaderboard_refresh(limit_count integer default 100)
returns table (
  rank bigint,
  run_id uuid,
  player_id uuid,
  username text,
  display_name text,
  avatar_url text,
  score integer,
  achieved_at timestamptz,
  record_held_since timestamptz
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
  'Authenticated live leaderboard refresh (6/minute/player) returning the same record date and #1 tenure metadata as the public initial read.';

notify pgrst, 'reload schema';

commit;
