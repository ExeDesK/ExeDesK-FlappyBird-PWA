import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  availableAvatarProviders,
  firstConnectedProvider,
  providerAvatarUrl,
  resolvedAvatarProvider,
} from '../site/src/auth/provider-profile.js';
import { avatarHue, avatarInitials } from '../site/src/ui/avatar-fallback.js';
import {
  PROFILE_DISPLAY_NAME_MAX,
  ProfileClient,
  normalizeDisplayName,
  profileFromUser,
} from '../site/src/api/profile-client.js';

const linkedUser = {
  id: 'user-1',
  email: 'player@example.test',
  app_metadata: {
    provider: 'discord',
    providers: ['discord', 'google'],
  },
  user_metadata: {
    user_name: 'firstbird',
    global_name: 'First Bird',
    avatar_url: 'https://cdn.example/discord-current.png',
  },
  identities: [
    {
      id: 'google-id',
      provider: 'google',
      created_at: '2026-09-23T12:00:00Z',
      identity_data: {
        name: 'Google Bird',
        picture: 'https://cdn.example/google.png',
        email: 'google@example.test',
      },
    },
    {
      id: 'discord-id',
      provider: 'discord',
      created_at: '2026-09-20T12:00:00Z',
      identity_data: {
        user_name: 'firstbird',
        global_name: 'First Bird',
        avatar_url: 'https://cdn.example/discord.png',
        email: 'discord@example.test',
      },
    },
  ],
};

test('signup provider remains the default if linked-identity timestamps are misleading', () => {
  const user = {
    id: 'user-reordered',
    app_metadata: { provider: 'discord', providers: ['discord', 'google'] },
    user_metadata: { global_name: 'First Bird', avatar_url: 'https://cdn.example/discord.png' },
    identities: [
      {
        provider: 'google',
        created_at: '2025-01-01T00:00:00Z',
        identity_data: { name: 'Google Bird', picture: 'https://cdn.example/google.png' },
      },
      {
        provider: 'discord',
        created_at: '2026-01-01T00:00:00Z',
        identity_data: { global_name: 'First Bird', avatar_url: 'https://cdn.example/discord.png' },
      },
    ],
  };

  assert.equal(firstConnectedProvider(user), 'discord');
  assert.equal(resolvedAvatarProvider(user, {}), 'discord');
});

test('provider profile metadata exposes both linked avatars and keeps the first connected provider as default', () => {
  const choices = availableAvatarProviders(linkedUser);
  assert.deepEqual(choices.map(item => item.provider), ['discord', 'google']);
  assert.equal(firstConnectedProvider(linkedUser), 'discord');
  assert.equal(resolvedAvatarProvider(linkedUser, {}), 'discord');
  assert.equal(resolvedAvatarProvider(linkedUser, { avatar_provider: 'google' }), 'google');
  assert.equal(providerAvatarUrl(linkedUser, 'discord'), 'https://cdn.example/discord.png');
  assert.equal(providerAvatarUrl(linkedUser, 'google'), 'https://cdn.example/google.png');
});

test('profile fallback keeps first-provider pseudo and avatar for a new account', () => {
  assert.deepEqual(profileFromUser(linkedUser), {
    id: 'user-1',
    username: 'firstbird',
    display_name: 'First Bird',
    avatar_url: 'https://cdn.example/discord-current.png',
    avatar_provider: 'discord',
    best_score: 0,
  });
});

test('display-name normalization is friendly to pasted whitespace and preserves Unicode', () => {
  assert.equal(normalizeDisplayName('  Dylan   🐦\nSamson  '), 'Dylan 🐦 Samson');
  assert.equal(normalizeDisplayName('   '), '');
  assert.equal(PROFILE_DISPLAY_NAME_MAX, 24);
});

test('ProfileClient persists a custom pseudo and the selected linked-provider avatar', async () => {
  const previousFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify([{
      id: 'user-1',
      username: 'firstbird',
      display_name: 'Dylan',
      avatar_url: 'https://cdn.example/google.png',
      avatar_provider: 'google',
      best_score: 42,
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const client = new ProfileClient({
      url: 'https://project-ref.supabase.co',
      publishableKey: 'publishable',
    });
    const profile = await client.updatePreferences('access-token', linkedUser, {
      displayName: '  Dylan  ',
      avatarProvider: 'google',
    });

    assert.equal(profile.display_name, 'Dylan');
    assert.equal(profile.avatar_provider, 'google');
    assert.equal(request.init.method, 'PATCH');
    assert.equal(request.init.headers.Authorization, 'Bearer access-token');
    assert.deepEqual(JSON.parse(request.init.body), {
      display_name: 'Dylan',
      avatar_provider: 'google',
      avatar_url: 'https://cdn.example/google.png',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('ProfileClient rejects an unavailable avatar provider and an oversized pseudo', async () => {
  const client = new ProfileClient({
    url: 'https://project-ref.supabase.co',
    publishableKey: 'publishable',
  });

  await assert.rejects(
    () => client.updatePreferences('token', linkedUser, {
      displayName: 'Bird',
      avatarProvider: 'github',
    }),
    /photo de profil sélectionnée/i,
  );

  await assert.rejects(
    () => client.updatePreferences('token', linkedUser, {
      displayName: 'x'.repeat(PROFILE_DISPLAY_NAME_MAX + 1),
      avatarProvider: 'discord',
    }),
    /limité à 24 caractères/i,
  );
});

test('profile customization migration adds a bounded provider preference without rewriting existing accounts', async () => {
  const sql = await readFile(new URL('../supabase/012_profile_customization.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists avatar_provider text/i);
  assert.match(sql, /avatar_provider is null or avatar_provider in \('discord', 'google'\)/i);
  assert.match(sql, /grant update \(username, display_name, avatar_url, avatar_provider\)[\s\S]*on table public\.profiles[\s\S]*to authenticated/i);
  assert.match(sql, /initial_avatar_url text :=/i);
  assert.match(sql, /initial_provider in \('discord', 'google'\)/i);
  assert.doesNotMatch(sql, /update\s+public\.profiles\s+set/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.profiles/i);
});


test('profile permissions hotfix reasserts Data API grants and owner-only RLS', async () => {
  const sql = await readFile(new URL('../supabase/013_profile_permissions_hotfix.sql', import.meta.url), 'utf8');
  assert.match(sql, /grant usage on schema public to authenticated/i);
  assert.match(sql, /grant select on table public\.profiles to anon, authenticated/i);
  assert.match(sql, /revoke update on table public\.profiles from authenticated/i);
  assert.match(sql, /grant update \(username, display_name, avatar_url, avatar_provider\)[\s\S]*to authenticated/i);
  assert.match(sql, /create policy "Users can update their own profile"[\s\S]*for update[\s\S]*auth\.uid\(\)[\s\S]*= id/i);
  assert.doesNotMatch(sql, /grant update[\s\S]*best_score/i);
});

test('a revoked selected provider falls back to the remaining provider avatar', async () => {
  const previousFetch = globalThis.fetch;
  let patchBody = null;
  const discordOnlyUser = {
    id: 'user-1',
    app_metadata: { provider: 'discord', providers: ['discord'] },
    identities: [{
      provider: 'discord',
      identity_data: { global_name: 'First Bird', avatar_url: 'https://cdn.example/discord.png' },
    }],
  };
  globalThis.fetch = async (_input, init = {}) => {
    patchBody = JSON.parse(init.body);
    return new Response(JSON.stringify([{
      id: 'user-1', display_name: 'First Bird', avatar_provider: 'discord',
      avatar_url: 'https://cdn.example/discord.png', best_score: 42,
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const client = new ProfileClient({ url: 'https://project-ref.supabase.co', publishableKey: 'publishable' });
    const profile = await client.refreshSelectedAvatar('token', discordOnlyUser, {
      id: 'user-1', avatar_provider: 'google', avatar_url: 'https://cdn.example/google.png',
    });
    assert.deepEqual(patchBody, {
      avatar_provider: 'discord',
      avatar_url: 'https://cdn.example/discord.png',
    });
    assert.equal(profile.avatar_provider, 'discord');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a revoked provider with no remaining provider picture clears stale public avatar data', async () => {
  const previousFetch = globalThis.fetch;
  let patchBody = null;
  const noAvatarUser = {
    id: 'user-1',
    app_metadata: { provider: 'discord', providers: ['discord'] },
    identities: [{ provider: 'discord', identity_data: { global_name: 'No Picture Bird' } }],
  };
  globalThis.fetch = async (_input, init = {}) => {
    patchBody = JSON.parse(init.body);
    return new Response(JSON.stringify([{
      id: 'user-1', display_name: 'No Picture Bird', avatar_provider: null, avatar_url: null, best_score: 0,
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const client = new ProfileClient({ url: 'https://project-ref.supabase.co', publishableKey: 'publishable' });
    await client.refreshSelectedAvatar('token', noAvatarUser, {
      id: 'user-1', avatar_provider: 'google', avatar_url: 'https://cdn.example/google.png',
    });
    assert.deepEqual(patchBody, { avatar_provider: null, avatar_url: null });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('profile display names remain intentionally non-unique', async () => {
  const sqlFiles = [
    '../supabase/001_profiles.sql',
    '../supabase/012_profile_customization.sql',
    '../supabase/013_profile_permissions_hotfix.sql',
  ];
  const sql = (await Promise.all(sqlFiles.map(file => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
  assert.doesNotMatch(sql, /unique\s*\(\s*(?:username|display_name)\s*\)/i);
  assert.doesNotMatch(sql, /create\s+unique\s+index[\s\S]{0,120}(?:username|display_name)/i);
});


test('generated avatar fallback is deterministic and readable without a provider picture', () => {
  assert.equal(avatarInitials('Dylan Samson'), 'DS');
  assert.equal(avatarInitials('Flappy'), 'FL');
  assert.equal(avatarHue('Dylan Samson'), avatarHue('Dylan Samson'));
  assert.ok(avatarHue('Dylan Samson') >= 0 && avatarHue('Dylan Samson') < 360);
});
