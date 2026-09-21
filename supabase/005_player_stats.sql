-- Flappy13 v0.2.7.3b-dev3 - authoritative lifetime player statistics.
-- Run after 004_leaderboard.sql.
-- Browser clients never write this table. Statistics are derived exclusively
-- from rows that transition to status = 'verified' in public.verified_runs.

create table if not exists public.player_stats (
  player_id uuid primary key references auth.users(id) on delete cascade,
  verified_runs_count bigint not null default 0,
  total_score bigint not null default 0,
  best_score integer not null default 0,
  best_run_id uuid references public.verified_runs(run_id) on delete set null,
  best_score_at timestamptz,
  first_verified_run_at timestamptz,
  last_verified_run_at timestamptz,
  deaths_pipe_top bigint not null default 0,
  deaths_pipe_bottom bigint not null default 0,
  deaths_ground bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint player_stats_verified_runs_count_nonnegative
    check (verified_runs_count >= 0),
  constraint player_stats_total_score_nonnegative
    check (total_score >= 0),
  constraint player_stats_best_score_nonnegative
    check (best_score >= 0),
  constraint player_stats_deaths_pipe_top_nonnegative
    check (deaths_pipe_top >= 0),
  constraint player_stats_deaths_pipe_bottom_nonnegative
    check (deaths_pipe_bottom >= 0),
  constraint player_stats_deaths_ground_nonnegative
    check (deaths_ground >= 0),
  constraint player_stats_death_count_matches_runs
    check (
      deaths_pipe_top + deaths_pipe_bottom + deaths_ground = verified_runs_count
    )
);

alter table public.player_stats enable row level security;

-- Lifetime statistics are server-owned. Public/player-facing reads will be
-- exposed later through deliberately scoped RPCs, never direct table access.
revoke all on table public.player_stats from public, anon, authenticated;
grant usage on schema public to service_role;
grant select on table public.player_stats to service_role;

comment on table public.player_stats is
  'Server-owned lifetime aggregates derived only from authoritative verified runs.';
comment on column public.player_stats.best_run_id is
  'Authoritative historical record run. Retention must preserve this run when non-null.';
comment on column public.player_stats.deaths_pipe_top is
  'Lifetime verified deaths whose authoritative collision is upper-pipe.';
comment on column public.player_stats.deaths_pipe_bottom is
  'Lifetime verified deaths whose authoritative collision is lower-pipe.';
comment on column public.player_stats.deaths_ground is
  'Lifetime verified deaths whose authoritative collision is ground.';

-- Backfill once for players that do not yet have lifetime aggregates. ON
-- CONFLICT DO NOTHING is intentional: after retention is introduced, rerunning
-- this migration must never overwrite lifetime counters with only retained runs.
with verified as (
  select
    vr.run_id,
    vr.player_id,
    vr.verified_score,
    vr.collision,
    vr.resolved_at
  from public.verified_runs as vr
  where vr.status = 'verified'
    and vr.verified_score is not null
    and vr.collision in ('ground', 'upper-pipe', 'lower-pipe')
    and vr.resolved_at is not null
),
aggregates as (
  select
    v.player_id,
    count(*)::bigint as verified_runs_count,
    sum(v.verified_score)::bigint as total_score,
    min(v.resolved_at) as first_verified_run_at,
    max(v.resolved_at) as last_verified_run_at,
    count(*) filter (where v.collision = 'upper-pipe')::bigint as deaths_pipe_top,
    count(*) filter (where v.collision = 'lower-pipe')::bigint as deaths_pipe_bottom,
    count(*) filter (where v.collision = 'ground')::bigint as deaths_ground
  from verified as v
  group by v.player_id
),
bests as (
  select distinct on (v.player_id)
    v.player_id,
    v.verified_score as best_score,
    v.run_id as best_run_id,
    v.resolved_at as best_score_at
  from verified as v
  order by
    v.player_id,
    v.verified_score desc,
    v.resolved_at asc,
    v.run_id asc
)
insert into public.player_stats (
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
  deaths_ground
)
select
  a.player_id,
  a.verified_runs_count,
  a.total_score,
  b.best_score,
  b.best_run_id,
  b.best_score_at,
  a.first_verified_run_at,
  a.last_verified_run_at,
  a.deaths_pipe_top,
  a.deaths_pipe_bottom,
  a.deaths_ground
from aggregates as a
join bests as b using (player_id)
on conflict (player_id) do nothing;

create or replace function public.capture_verified_run_player_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'verified' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'verified' then
      return new;
    end if;
  end if;

  -- A verified row is guaranteed by verified_runs_state_shape_valid to carry
  -- an authoritative score, collision and resolved_at. These values were
  -- produced by the server replay, not supplied by the browser.
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
    now()
  )
  on conflict (player_id) do update
  set
    verified_runs_count = ps.verified_runs_count + 1,
    total_score = ps.total_score + excluded.total_score,
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

  return new;
end;
$$;

-- Keep both events explicit. The normal application path is UPDATE
-- issued -> verified; the INSERT trigger also protects future server-side
-- imports from bypassing lifetime aggregates.
drop trigger if exists player_stats_on_verified_run_insert on public.verified_runs;
create trigger player_stats_on_verified_run_insert
after insert on public.verified_runs
for each row
when (new.status = 'verified')
execute procedure public.capture_verified_run_player_stats();

drop trigger if exists player_stats_on_verified_run_update on public.verified_runs;
create trigger player_stats_on_verified_run_update
after update of status on public.verified_runs
for each row
when (new.status = 'verified' and old.status is distinct from 'verified')
execute procedure public.capture_verified_run_player_stats();

revoke all on function public.capture_verified_run_player_stats() from public, anon, authenticated;

notify pgrst, 'reload schema';
