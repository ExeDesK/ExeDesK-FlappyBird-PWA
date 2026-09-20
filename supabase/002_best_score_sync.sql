-- Flappy13 v0.2.7.1b - cross-device personal best synchronization.
-- Run after 001_profiles.sql. Safe to run more than once.

alter table public.profiles
  add column if not exists best_score integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_best_score_nonnegative'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_best_score_nonnegative
      check (best_score >= 0);
  end if;
end
$$;

-- The browser may edit profile identity fields, but not best_score directly.
-- Record updates go through sync_best_score(), which only moves the value up.
revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_url) on public.profiles to authenticated;

create or replace function public.sync_best_score(candidate_score integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  merged_score integer;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if candidate_score is null or candidate_score < 0 or candidate_score > 2147483647 then
    raise exception 'invalid score';
  end if;

  insert into public.profiles (id, best_score)
  values (current_user_id, candidate_score)
  on conflict (id) do update
    set best_score = greatest(public.profiles.best_score, excluded.best_score)
  returning best_score into merged_score;

  return merged_score;
end;
$$;

revoke all on function public.sync_best_score(integer) from public, anon;
grant execute on function public.sync_best_score(integer) to authenticated;
