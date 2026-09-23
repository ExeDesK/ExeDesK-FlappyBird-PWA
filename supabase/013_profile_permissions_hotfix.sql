-- Flappy13 v0.2.7.4b-dev11-hotfix1 - profile customization permissions.
-- Re-asserts the Data API grants required by PostgREST after profile
-- customization introduced avatar_provider. Safe to run more than once.

-- Access to the exposed public schema/table is a separate layer from RLS.
grant usage on schema public to authenticated;
grant select on table public.profiles to anon, authenticated;

-- Keep best_score protected from direct browser writes while allowing the
-- exact public-profile columns used by ProfileClient.patch().
revoke update on table public.profiles from authenticated;
grant update (username, display_name, avatar_url, avatar_provider)
  on table public.profiles
  to authenticated;

-- Re-assert the owner-only update policy in case the database drifted from the
-- original 001_profiles.sql policy set.
alter table public.profiles enable row level security;

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

notify pgrst, 'reload schema';
