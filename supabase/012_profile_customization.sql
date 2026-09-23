-- Flappy13 v0.2.7.4b-dev11 - player profile personalization.
-- Adds a persistent avatar-provider preference without changing player IDs,
-- verified history, leaderboard ownership or existing profile values.
-- Safe to run more than once from Supabase SQL Editor.

alter table public.profiles
  add column if not exists avatar_provider text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_avatar_provider_supported'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_avatar_provider_supported
      check (avatar_provider is null or avatar_provider in ('discord', 'google'));
  end if;
end
$$;

-- Existing grants from 002_best_score_sync.sql already allow the owner to
-- update display_name and avatar_url. Add only the new preference column.
grant update (avatar_provider) on public.profiles to authenticated;

comment on column public.profiles.avatar_provider is
  'Linked OAuth provider selected by the player as the source of the public profile avatar.';

notify pgrst, 'reload schema';


-- New accounts created after this migration remember the signup provider as
-- their initial avatar source when that provider supplied a picture. Existing
-- rows are intentionally untouched: linking a second provider must never
-- rewrite an existing player's public profile without an explicit save.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_avatar_url text := coalesce(
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'picture'
  );
  initial_provider text := new.raw_app_meta_data ->> 'provider';
begin
  insert into public.profiles (
    id,
    username,
    display_name,
    avatar_url,
    avatar_provider
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'user_name',
      new.raw_user_meta_data ->> 'preferred_username',
      new.raw_user_meta_data ->> 'name'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'global_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'user_name'
    ),
    initial_avatar_url,
    case
      when initial_avatar_url is not null
       and initial_provider in ('discord', 'google')
      then initial_provider
      else null
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
