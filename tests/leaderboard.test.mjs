import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { AuthClient } from '../site/src/auth.js';
import { leaderboardName, parseLeaderboardRows } from '../site/src/leaderboard.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function installNavigator(online = true) {
  const previous = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: online },
  });
  return () => {
    if (previous === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous });
  };
}

const config = {
  url: 'https://project-ref.supabase.co',
  publishableKey: 'sb_publishable_test',
};

const rows = [
  {
    rank: 1,
    player_id: '123e4567-e89b-12d3-a456-426614174000',
    username: 'birdplayer',
    display_name: 'Bird Player',
    avatar_url: 'https://cdn.example/avatar.png',
    score: 42,
    achieved_at: '2026-09-20T20:00:00.000Z',
  },
  {
    rank: 2,
    player_id: '223e4567-e89b-12d3-a456-426614174000',
    username: 'second',
    display_name: null,
    avatar_url: null,
    score: 17,
    achieved_at: '2026-09-20T20:01:00.000Z',
  },
];

test('leaderboard payload is normalized and keeps one unique player per row', () => {
  const parsed = parseLeaderboardRows(rows);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].score, 42);
  assert.equal(leaderboardName(parsed[0]), 'Bird Player');
  assert.equal(leaderboardName(parsed[1]), 'second');
  assert.throws(
    () => parseLeaderboardRows([rows[0], { ...rows[0], rank: 2 }]),
    /player/i,
  );
});

test('public leaderboard RPC works without a Discord session', async () => {
  const restoreNavigator = installNavigator(true);
  const previousFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const auth = new AuthClient({ ...config, storage: new MemoryStorage() });
    assert.equal(auth.session, null);
    const result = await auth.fetchLeaderboard({ limit: 100 });
    assert.equal(result.length, 2);
    assert.equal(request.url, 'https://project-ref.supabase.co/rest/v1/rpc/get_leaderboard');
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.apikey, 'sb_publishable_test');
    assert.equal('Authorization' in request.init.headers, false);
    assert.deepEqual(JSON.parse(request.init.body), { limit_count: 100 });
  } finally {
    globalThis.fetch = previousFetch;
    restoreNavigator();
  }
});

test('leaderboard SQL exposes only verified per-player best scores through a public RPC', async () => {
  const sql = await readFile(new URL('../supabase/004_leaderboard.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace function public\.get_leaderboard/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /where vr\.status = 'verified'/i);
  assert.match(sql, /distinct on \(vr\.player_id\)/i);
  assert.match(sql, /vr\.verified_score desc/i);
  assert.match(sql, /grant execute on function public\.get_leaderboard\(integer\) to anon, authenticated/i);
  assert.doesNotMatch(sql, /tap_ticks|replay_hash|seed|collision/);
});

test('leaderboard UI is public, dedicated, explains sign-in, and the original scores action opens it', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const main = await readFile(new URL('../site/src/main.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../site/style.css', import.meta.url), 'utf8');
  assert.match(html, /<dialog id="leaderboard-dialog"/);
  assert.match(html, /id="close-leaderboard"/);
  assert.match(html, /Se connecter pour appara\u00eetre sur le classement\./);
  assert.match(html, /UNIQUEMENT LES RUNS V\u00c9RIFI\u00c9S/);
  assert.doesNotMatch(html, /id="leaderboard-card"/);
  assert.match(main, /type === 'local-scores'[\s\S]*openLeaderboard\(\{ force: true \}\)/);
  assert.match(main, /const leaderboardDialog = \$\('leaderboard-dialog'\)/);
  assert.match(main, /leaderboardDialog\.showModal\(\)/);
  assert.match(main, /auth\.fetchLeaderboard\(\{ limit: 100 \}\)/);
  assert.match(main, /leaderboard-login-hint/);
  assert.match(css, /#leaderboard-dialog\[open\]/);
  assert.match(css, /#leaderboard-dialog::backdrop/);
});

test('personal leaderboard payload validates ranked and unranked states', async () => {
  const { parseLeaderboardContext } = await import('../site/src/leaderboard.js');
  const playerId = '323e4567-e89b-12d3-a456-426614174000';

  assert.deepEqual(parseLeaderboardContext([{
    player_id: playerId,
    global_rank: 42,
    best_score: 184,
    verified_runs_count: 736,
    best_score_at: '2026-09-20T20:00:00.000Z',
  }]), {
    player_id: playerId,
    global_rank: 42,
    best_score: 184,
    verified_runs_count: 736,
    best_score_at: '2026-09-20T20:00:00.000Z',
  });

  assert.deepEqual(parseLeaderboardContext([{
    player_id: playerId,
    global_rank: null,
    best_score: null,
    verified_runs_count: 0,
    best_score_at: null,
  }]), {
    player_id: playerId,
    global_rank: null,
    best_score: null,
    verified_runs_count: 0,
    best_score_at: null,
  });

  assert.throws(() => parseLeaderboardContext([{
    player_id: playerId,
    global_rank: 1,
    best_score: 10,
    verified_runs_count: 0,
    best_score_at: null,
  }]), /unranked/i);
});

test('personal leaderboard RPC is authenticated and never accepts a player id', async () => {
  const restoreNavigator = installNavigator(true);
  const previousFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify([{
      player_id: '323e4567-e89b-12d3-a456-426614174000',
      global_rank: 42,
      best_score: 184,
      verified_runs_count: 736,
      best_score_at: '2026-09-20T20:00:00.000Z',
    }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const auth = new AuthClient({ ...config, storage: new MemoryStorage() });
    auth.session = {
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenType: 'bearer',
      expiresAt: Date.now() + 3600000,
    };
    auth.user = { id: '323e4567-e89b-12d3-a456-426614174000' };

    const result = await auth.fetchMyLeaderboardContext();
    assert.equal(result.global_rank, 42);
    assert.equal(result.best_score, 184);
    assert.equal(request.url, 'https://project-ref.supabase.co/rest/v1/rpc/get_my_leaderboard_context');
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.Authorization, 'Bearer access');
    assert.deepEqual(JSON.parse(request.init.body), {});
  } finally {
    globalThis.fetch = previousFetch;
    restoreNavigator();
  }
});

test('personal leaderboard SQL derives caller identity from auth.uid and is not anonymous', async () => {
  const sql = await readFile(new URL('../supabase/007_personal_leaderboard_context.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace function public\.get_my_leaderboard_context\(\)/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /from public\.player_stats as ps/i);
  assert.match(sql, /row_number\(\) over/i);
  assert.match(sql, /ps\.best_score desc/i);
  assert.match(sql, /ps\.best_score_at asc/i);
  assert.match(sql, /ps\.player_id asc/i);
  assert.match(sql, /grant execute on function public\.get_my_leaderboard_context\(\) to authenticated, service_role/i);
  assert.match(sql, /revoke all on function public\.get_my_leaderboard_context\(\) from public, anon/i);
  assert.match(sql, /get_my_leaderboard_context\(\)\s*returns table/i);
});

test('leaderboard modal contains a dedicated personal context card for signed-in players', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const main = await readFile(new URL('../site/src/main.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../site/style.css', import.meta.url), 'utf8');

  assert.match(html, /id="leaderboard-player-card"/);
  assert.match(html, /VOTRE CLASSEMENT/);
  assert.match(html, /id="leaderboard-player-rank"/);
  assert.match(html, /id="leaderboard-player-best"/);
  assert.match(html, /id="leaderboard-player-runs"/);
  assert.match(html, /id="leaderboard-player-record-date"/);
  assert.match(main, /auth\.fetchMyLeaderboardContext\(\)/);
  assert.match(main, /PAS ENCORE CLASSÉ/);
  assert.match(main, /leaderboardContext\.global_rank/);
  assert.match(css, /\.leaderboard-player-card/);
  assert.match(css, /\.leaderboard-player-metrics/);
});
