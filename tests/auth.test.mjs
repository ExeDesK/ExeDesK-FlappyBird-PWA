import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthClient, profileFromUser } from '../site/src/auth.js';

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
      profile: { id: 'user-1', username: 'birdplayer', display_name: 'Bird Player', avatar_url: null },
    }));
    const auth = new AuthClient({ ...config, storage });
    const state = await auth.init();
    assert.equal(state.status, 'offline');
    assert.equal(state.profile.username, 'birdplayer');
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
  });
});
