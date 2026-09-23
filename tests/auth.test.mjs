import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { AUTH_LINK_INTENT_KEY, AuthClient, identitiesFromUser, profileFromUser } from '../site/src/auth.js';
import { BestScoreClient } from '../site/src/api/best-score-client.js';
import { VerifiedRunClient } from '../site/src/api/verified-run-api.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function installBrowser({ hash = '', online = true } = {}) {
  const previous = {
    location: globalThis.location,
    history: globalThis.history,
    navigator: globalThis.navigator,
    fetch: globalThis.fetch,
  };
  let assigned = null;
  let replaced = null;

  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      origin: 'https://exedesk.github.io',
      pathname: '/FlappyBird-PWA/',
      search: '',
      hash,
      assign(value) { assigned = value; },
    },
  });
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: { replaceState(_a, _b, value) { replaced = value; } },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: online },
  });

  return {
    get assigned() { return assigned; },
    get replaced() { return replaced; },
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else Object.defineProperty(globalThis, key, { configurable: true, value });
      }
    },
  };
}

const config = {
  url: 'https://project-ref.supabase.co',
  publishableKey: 'sb_publishable_test',
};

test('Discord login targets Supabase authorize endpoint and the GitHub Pages callback', () => {
  const browser = installBrowser();
  try {
    const auth = new AuthClient({ ...config, storage: new MemoryStorage() });
    auth.signInWithDiscord();
    const url = new URL(browser.assigned);
    assert.equal(url.origin, 'https://project-ref.supabase.co');
    assert.equal(url.pathname, '/auth/v1/authorize');
    assert.equal(url.searchParams.get('provider'), 'discord');
    assert.equal(url.searchParams.get('redirect_to'), 'https://exedesk.github.io/FlappyBird-PWA/');
    assert.equal(url.searchParams.get('scopes'), 'identify email');
  } finally {
    browser.restore();
  }
});


test('legacy Discord accounts keep the same canonical user id and are exposed as one linked identity', () => {
  const auth = new AuthClient({ ...config, storage: new MemoryStorage() });
  auth.user = { id: 'legacy-user-uuid' };
  auth.profile = {
    id: 'legacy-user-uuid',
    username: 'legacybird',
    display_name: 'Legacy Bird',
    avatar_url: null,
    best_score: 27,
  };

  const state = auth.snapshot();
  assert.equal(state.user.id, 'legacy-user-uuid');
  assert.equal(state.profile.id, 'legacy-user-uuid');
  assert.deepEqual(state.identities.map(identity => identity.provider), ['discord']);
  assert.equal(state.identities[0].legacy, true);
});

test('identity metadata is normalized without changing the profile ownership key', () => {
  const identities = identitiesFromUser({
    id: 'player-1',
    app_metadata: { providers: ['discord', 'discord'] },
    identities: [{
      identity_id: 'identity-discord',
      provider: 'discord',
      created_at: '2026-09-01T00:00:00Z',
    }],
  });

  assert.deepEqual(identities, [{
    identity_id: 'identity-discord',
    provider: 'discord',
    created_at: '2026-09-01T00:00:00Z',
    last_sign_in_at: null,
  }]);
});

test('manual identity linking uses the authenticated Supabase identity endpoint and preserves the current account', async () => {
  const browser = installBrowser();
  const previousFetch = globalThis.fetch;
  const storage = new MemoryStorage();
  let request = null;
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({
      url: 'https://discord.com/oauth2/authorize?client_id=test',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const auth = new AuthClient({ ...config, storage });
    auth.session = {
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenType: 'bearer',
      expiresAt: Date.now() + 3600000,
    };
    auth.user = {
      id: 'existing-user-uuid',
      identities: [{ identity_id: 'identity-email', provider: 'email' }],
    };
    auth.profile = {
      id: 'existing-user-uuid',
      username: 'existing',
      display_name: 'Existing Player',
      avatar_url: null,
      best_score: 99,
    };

    await auth.linkIdentity('discord');

    const url = new URL(request.url);
    assert.equal(url.pathname, '/auth/v1/user/identities/authorize');
    assert.equal(url.searchParams.get('provider'), 'discord');
    assert.equal(url.searchParams.get('redirect_to'), 'https://exedesk.github.io/FlappyBird-PWA/');
    assert.equal(url.searchParams.get('skip_http_redirect'), 'true');
    assert.equal(url.searchParams.get('scopes'), 'identify email');
    assert.equal(request.init.headers.Authorization, 'Bearer access');
    assert.equal(request.init.headers.apikey, config.publishableKey);
    assert.equal(browser.assigned, 'https://discord.com/oauth2/authorize?client_id=test');
    assert.equal(auth.user.id, 'existing-user-uuid');
    assert.equal(auth.profile.id, 'existing-user-uuid');
    assert.equal(JSON.parse(storage.getItem(AUTH_LINK_INTENT_KEY)).provider, 'discord');
  } finally {
    globalThis.fetch = previousFetch;
    browser.restore();
  }
});

test('identity-link callback reuses the existing profile id instead of creating a new game account', async () => {
  const browser = installBrowser({
    hash: '#access_token=linked-access&refresh_token=linked-refresh&expires_in=3600&token_type=bearer&provider=discord',
  });
  const previousFetch = globalThis.fetch;
  const storage = new MemoryStorage();
  storage.setItem(AUTH_LINK_INTENT_KEY, JSON.stringify({
    provider: 'discord',
    startedAt: Date.now(),
  }));
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({
        id: 'existing-user-uuid',
        user_metadata: { user_name: 'birdplayer' },
        identities: [
          { identity_id: 'identity-email', provider: 'email' },
          { identity_id: 'identity-discord', provider: 'discord' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/rest/v1/profiles?')) {
      return new Response(JSON.stringify([{
        id: 'existing-user-uuid',
        username: 'birdplayer',
        display_name: 'Bird Player',
        avatar_url: null,
        best_score: 17,
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const auth = new AuthClient({ ...config, storage });
    const state = await auth.init();
    assert.equal(state.status, 'signed_in');
    assert.equal(state.callbackResult, 'identity_linked');
    assert.equal(state.callbackProvider, 'discord');
    assert.equal(state.user.id, 'existing-user-uuid');
    assert.equal(state.profile.id, 'existing-user-uuid');
    assert.deepEqual(state.identities.map(identity => identity.provider), ['email', 'discord']);
    assert.equal(storage.getItem(AUTH_LINK_INTENT_KEY), null);
  } finally {
    globalThis.fetch = previousFetch;
    browser.restore();
  }
});

test('the last linked identity cannot be removed client-side', async () => {
  const browser = installBrowser();
  try {
    const auth = new AuthClient({ ...config, storage: new MemoryStorage() });
    auth.session = {
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenType: 'bearer',
      expiresAt: Date.now() + 3600000,
    };
    auth.user = {
      id: 'existing-user-uuid',
      identities: [{ identity_id: 'identity-discord', provider: 'discord' }],
    };
    auth.profile = { id: 'existing-user-uuid' };

    await assert.rejects(
      () => auth.unlinkIdentity('identity-discord'),
      /dernier moyen de connexion/i,
    );
  } finally {
    browser.restore();
  }
});

test('OAuth fragment is consumed, validated, profiled and removed from the visible URL', async () => {
  const browser = installBrowser({
    hash: '#access_token=access123&refresh_token=refresh123&expires_in=3600&token_type=bearer&provider=discord',
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({
        id: 'user-1',
        email: 'player@example.test',
        user_metadata: {
          user_name: 'birdplayer',
          full_name: 'Bird Player',
          avatar_url: 'https://cdn.example/avatar.png',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/rest/v1/profiles?')) {
      return new Response(JSON.stringify([{
        id: 'user-1',
        username: 'birdplayer',
        display_name: 'Bird Player',
        avatar_url: 'https://cdn.example/avatar.png',
        best_score: 17,
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const auth = new AuthClient({ ...config, storage: new MemoryStorage() });
    const state = await auth.init();
    assert.equal(state.status, 'signed_in');
    assert.equal(state.user.id, 'user-1');
    assert.equal(state.profile.username, 'birdplayer');
    assert.equal(state.profile.best_score, 17);
    assert.equal(state.callbackResult, 'signed_in');
    assert.equal(browser.replaced, '/FlappyBird-PWA/');
    assert.equal('session' in state, false, 'public snapshot must not expose tokens');
  } finally {
    globalThis.fetch = previousFetch;
    browser.restore();
  }
});

test('offline startup keeps a cached Discord profile usable without blocking the game', async () => {
  const browser = installBrowser({ online: false });
  try {
    const storage = new MemoryStorage();
    storage.setItem('flappy13-auth-v1', JSON.stringify({
      session: {
        accessToken: 'access',
        refreshToken: 'refresh',
        tokenType: 'bearer',
        expiresAt: Date.now() + 3600000,
      },
      user: { id: 'user-1' },
      profile: { id: 'user-1', username: 'birdplayer', display_name: 'Bird Player', avatar_url: null, best_score: 17 },
    }));
    const auth = new AuthClient({ ...config, storage });
    const state = await auth.init();
    assert.equal(state.status, 'offline');
    assert.equal(state.profile.username, 'birdplayer');
    assert.equal(state.profile.best_score, 17);
  } finally {
    browser.restore();
  }
});

test('Discord user metadata provides a profile fallback if the profile table is unavailable', () => {
  assert.deepEqual(profileFromUser({
    id: 'abc',
    email: 'fallback@example.test',
    user_metadata: {
      user_name: 'flappyfan',
      global_name: 'Flappy Fan',
      picture: 'https://cdn.example/fan.png',
    },
  }), {
    id: 'abc',
    username: 'flappyfan',
    display_name: 'Flappy Fan',
    avatar_url: 'https://cdn.example/fan.png',
    best_score: 0,
  });
});

test('BestScoreClient calls the atomic Supabase RPC and accepts the higher remote score', async () => {
  const browser = installBrowser();
  const previousFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), init };
    return new Response('42', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const auth = new AuthClient({ ...config, storage: new MemoryStorage() });
    auth.session = {
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenType: 'bearer',
      expiresAt: Date.now() + 3600000,
    };
    auth.user = { id: 'user-1', user_metadata: { user_name: 'birdplayer' } };
    auth.profile = { id: 'user-1', username: 'birdplayer', display_name: 'Bird Player', avatar_url: null, best_score: 12 };

    const scoreClient = new BestScoreClient({
      ...config,
      getAccessToken: () => auth.accessToken(),
    });
    const merged = await scoreClient.sync(12);
    assert.equal(merged, 42);
    assert.equal(auth.profile.best_score, 12, 'score transport must not mutate auth/profile state');
    assert.equal(request.url, 'https://project-ref.supabase.co/rest/v1/rpc/sync_best_score');
    assert.equal(request.init.method, 'POST');
    assert.deepEqual(JSON.parse(request.init.body), { candidate_score: 12 });
    assert.equal(request.init.headers.Authorization, 'Bearer access');
  } finally {
    globalThis.fetch = previousFetch;
    browser.restore();
  }
});

test('VerifiedRunClient start sends the user JWT and validates the server ticket', async () => {
  const browser = installBrowser();
  const previousFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({
      schema: 'flappy13-run-ticket-v1',
      run_id: '123e4567-e89b-12d3-a456-426614174000',
      seed: -123456789,
      physics_version: 'flappy13-physics-v1',
      issued_at: '2026-09-20T18:00:00.000Z',
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const auth = new AuthClient({ ...config, storage: new MemoryStorage() });
    auth.session = {
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenType: 'bearer',
      expiresAt: Date.now() + 3600000,
    };

    const verifiedRuns = new VerifiedRunClient({
      ...config,
      getAccessToken: () => auth.accessToken(),
    });
    const ticket = await verifiedRuns.start();

    assert.equal(ticket.seed, -123456789);
    assert.equal(ticket.physics_version, 'flappy13-physics-v1');
    assert.equal(request.url, 'https://project-ref.supabase.co/functions/v1/run-start');
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.Authorization, 'Bearer access');
    assert.equal(request.init.headers.apikey, config.publishableKey);
    assert.equal(request.init.body, '{}');
  } finally {
    globalThis.fetch = previousFetch;
    browser.restore();
  }
});

test('VerifiedRunClient submission sends only replay inputs and validates the server result', async () => {
  const browser = installBrowser();
  const previousFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({
      schema: 'flappy13-run-result-v1',
      run_id: '123e4567-e89b-12d3-a456-426614174000',
      physics_version: 'flappy13-physics-v1',
      status: 'verified',
      terminal_tick: 53,
      score: 0,
      collision: 'ground',
      rejection_code: null,
      resolved_at: '2026-09-20T20:00:00.000Z',
      idempotent: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const auth = new AuthClient({ ...config, storage: new MemoryStorage() });
    auth.session = {
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenType: 'bearer',
      expiresAt: Date.now() + 3600000,
    };

    const verifiedRuns = new VerifiedRunClient({
      ...config,
      getAccessToken: () => auth.accessToken(),
    });
    const result = await verifiedRuns.submit({
      schema: 'flappy13-verified-run-v1',
      run_id: '123e4567-e89b-12d3-a456-426614174000',
      physics_version: 'flappy13-physics-v1',
      terminal_tick: 53,
      taps: [0],
      seed: 42,
      score: 999,
    });

    const body = JSON.parse(request.init.body);
    assert.equal(result.status, 'verified');
    assert.equal(result.score, 0);
    assert.equal(request.url, 'https://project-ref.supabase.co/functions/v1/run-submit');
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.Authorization, 'Bearer access');
    assert.deepEqual(body.taps, [0]);
    assert.equal('seed' in body, false);
    assert.equal('score' in body, false);
  } finally {
    globalThis.fetch = previousFetch;
    browser.restore();
  }
});

test('best score migration performs an atomic max merge and prevents direct browser writes', async () => {
  const sql = await readFile(new URL('../supabase/002_best_score_sync.sql', import.meta.url), 'utf8');
  assert.match(sql, /best_score integer not null default 0/i);
  assert.match(sql, /greatest\(public\.profiles\.best_score, excluded\.best_score\)/i);
  assert.match(sql, /revoke update on public\.profiles from authenticated/i);
  assert.match(sql, /grant execute on function public\.sync_best_score\(integer\) to authenticated/i);
});



test('successful profile refresh clears a previous transient profile error', async () => {
  const browser = installBrowser();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({
        id: 'user-1',
        user_metadata: { user_name: 'birdplayer' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/rest/v1/profiles?')) {
      return new Response(JSON.stringify([{
        id: 'user-1',
        username: 'birdplayer',
        display_name: 'Bird Player',
        avatar_url: null,
        best_score: 42,
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const auth = new AuthClient({ ...config, storage: new MemoryStorage() });
    auth.session = {
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenType: 'bearer',
      expiresAt: Date.now() + 3600000,
    };
    auth.error = 'Profil Supabase indisponible (HTTP 503).';
    const state = await auth.sync({ reason: 'manual' });
    assert.equal(state.status, 'signed_in');
    assert.equal(state.profile.best_score, 42);
    assert.equal(state.error, null);
  } finally {
    globalThis.fetch = previousFetch;
    browser.restore();
  }
});

test('VerifiedRunClient preserves run-start throttling metadata for the UI fallback', async () => {
  const browser = installBrowser();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: 'rate_limited',
    message: 'Trop de parties classées ont été démarrées récemment.',
    retry_after_seconds: 23,
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': '23',
    },
  });

  try {
    const verifiedRuns = new VerifiedRunClient({
      ...config,
      getAccessToken: () => 'access',
    });

    await assert.rejects(
      () => verifiedRuns.start(),
      error => {
        assert.equal(error.status, 429);
        assert.equal(error.code, 'rate_limited');
        assert.equal(error.retryAfter, 23);
        assert.equal(error.retryable, true);
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
    browser.restore();
  }
});
