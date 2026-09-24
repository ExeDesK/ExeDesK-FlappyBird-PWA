import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { AuthClient } from '../site/src/auth.js';
import { LeaderboardClient } from '../site/src/api/leaderboard-client.js';
import {
  leaderboardName,
  parseLeaderboardReplay,
  parseLeaderboardRows,
} from '../site/src/leaderboard.js';
import {
  REPLAY_SPEEDS,
  replayHandleFrame,
  replayProgressRatio,
  replayStepFromRatio,
  resolveReplayVisualContext,
} from '../site/src/replay/replay-viewer.js';
import { LeaderboardUI } from '../site/src/ui/leaderboard-ui.js';

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
    run_id: '323e4567-e89b-12d3-a456-426614174000',
    player_id: '123e4567-e89b-12d3-a456-426614174000',
    username: 'birdplayer',
    display_name: 'Bird Player',
    avatar_url: 'https://cdn.example/avatar.png',
    score: 42,
    achieved_at: '2026-09-20T20:00:00.000Z',
  },
  {
    rank: 2,
    run_id: '423e4567-e89b-12d3-a456-426614174000',
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
  assert.equal(parsed[0].run_id, rows[0].run_id);
  assert.equal(leaderboardName(parsed[0]), 'Bird Player');
  assert.equal(leaderboardName(parsed[1]), 'second');
  assert.throws(
    () => parseLeaderboardRows([rows[0], { ...rows[0], rank: 2 }]),
    /player/i,
  );
});

test('public leaderboard replay RPC exposes deterministic inputs without authentication', async () => {
  const restoreNavigator = installNavigator(true);
  const previousFetch = globalThis.fetch;
  let request = null;
  const payload = [{
    run_id: rows[0].run_id,
    player_id: rows[0].player_id,
    seed: -123456,
    physics_version: 'flappy13-physics-v1',
    terminal_tick: 53,
    taps: [0],
    score: 42,
    collision: 'ground',
    theme: 'vietnam',
    variant: 'night',
    resolved_at: rows[0].achieved_at,
  }];
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const leaderboard = new LeaderboardClient(config);
    const replay = await leaderboard.fetchReplay(rows[0].run_id);
    assert.deepEqual(replay, payload[0]);
    assert.equal(request.url, 'https://project-ref.supabase.co/rest/v1/rpc/get_leaderboard_replay');
    assert.equal('Authorization' in request.init.headers, false);
    assert.deepEqual(JSON.parse(request.init.body), { target_run_id: rows[0].run_id });
  } finally {
    globalThis.fetch = previousFetch;
    restoreNavigator();
  }
});

test('replay parser accepts legacy rows without visual context and rejects partial context', () => {
  const base = {
    run_id: rows[0].run_id,
    player_id: rows[0].player_id,
    seed: 42,
    physics_version: 'flappy13-physics-v1',
    terminal_tick: 53,
    taps: [0],
    score: 0,
    collision: 'ground',
    theme: null,
    variant: null,
    resolved_at: rows[0].achieved_at,
  };
  assert.equal(parseLeaderboardReplay([base]).theme, null);
  assert.throws(() => parseLeaderboardReplay([{ ...base, theme: 'france' }]), /incomplet/i);
});

test('replay controls expose deterministic speeds, seek math and the animated red-bird handle', () => {
  const replay = { terminal_tick: 119 };
  assert.deepEqual(REPLAY_SPEEDS, [1, 1.5, 2, 5]);
  assert.equal(replayProgressRatio(0, replay), 0);
  assert.equal(replayProgressRatio(60, replay), 0.5);
  assert.equal(replayProgressRatio(120, replay), 1);
  assert.equal(replayStepFromRatio(0.5, replay), 60);
  assert.equal(replayStepFromRatio(1, replay), 120);
  assert.equal(replayHandleFrame(0), 'bird2_0');
  assert.equal(replayHandleFrame(5), 'bird2_1');
  assert.equal(replayHandleFrame(10), 'bird2_2');
  assert.equal(replayHandleFrame(15), 'bird2_0');
});

test('recorded replay theme wins while legacy visual context is randomized', () => {
  const catalog = {
    schemaVersion: 2,
    selection: { pools: { country: { chance: 1 } } },
    themes: {
      original: {
        label: 'Original', base: true,
        backgroundDay: 'bg_day', backgroundNight: 'bg_night', pipeUp: 'pipe_up', pipeDown: 'pipe_down',
        bird0: 'bird{color}_0', bird1: 'bird{color}_1', bird2: 'bird{color}_2',
        land: { sprite: 'land', scrollMode: 'original' },
        fill: { skyDay: '#000', skyNight: '#000', land: '#000' },
      },
      france: {
        label: 'France', pool: 'country', weight: 1,
        backgroundDay: 'france_day', backgroundNight: 'france_night', pipeUp: 'france_up', pipeDown: 'france_down',
        bird0: 'france_0', bird1: 'france_1', bird2: 'france_2',
        land: { sprite: 'france_land', scrollMode: 'defilement' },
        fill: { skyDay: '#000', skyNight: '#000', land: '#000' },
      },
    },
  };
  assert.deepEqual(resolveReplayVisualContext({
    replay: { theme: 'france', variant: 'night' },
    catalog,
    random: () => 0,
  }), { theme: 'france', variant: 'night', source: 'recorded' });

  const values = [0, 0, 0.9];
  assert.deepEqual(resolveReplayVisualContext({
    replay: { theme: null, variant: null },
    catalog,
    random: () => values.shift() ?? 0,
  }), { theme: 'france', variant: 'night', source: 'random' });
});

test('public leaderboard RPC works without an authenticated session', async () => {
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
    const leaderboard = new LeaderboardClient(config);
    const result = await leaderboard.fetchLeaderboard({ limit: 100 });
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

test('replay migration stores visual context and exposes only current leaderboard-best runs', async () => {
  const sql = await readFile(new URL('../supabase/014_replay_viewing.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists visual_theme text/i);
  assert.match(sql, /drop function if exists public\.get_leaderboard\(integer\)/i);
  assert.match(sql, /add column if not exists visual_variant text/i);
  assert.match(sql, /create or replace function public\.get_leaderboard_replay\(target_run_id uuid\)/i);
  assert.match(sql, /from public\.get_leaderboard\(100\) as leaderboard/i);
  assert.match(sql, /where leaderboard\.run_id = vr\.run_id/i);
  assert.match(sql, /grant execute on function public\.get_leaderboard_replay\(uuid\) to anon, authenticated, service_role/i);
  assert.doesNotMatch(sql, /grant select on (table )?public\.verified_runs/i);
});

test('leaderboard UI is public, dedicated, explains sign-in, and the original scores action opens it', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const main = await readFile(new URL('../site/src/main.js', import.meta.url), 'utf8');
  const leaderboardUi = await readFile(new URL('../site/src/ui/leaderboard-ui.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../site/style.css', import.meta.url), 'utf8');
  assert.match(html, /<dialog id="leaderboard-dialog"/);
  assert.match(html, /id="close-leaderboard"/);
  assert.match(html, /Se connecter pour appara\u00eetre sur le classement\./);
  assert.match(html, /UNIQUEMENT LES RUNS V\u00c9RIFI\u00c9S/);
  assert.match(html, /<dialog id="replay-dialog"/);
  assert.doesNotMatch(html, /id="leaderboard-card"/);
  assert.match(main, /type === 'local-scores'[\s\S]*openLeaderboard\(\{ force: true \}\)/);
  assert.match(main, /const leaderboardDialog = \$\('leaderboard-dialog'\)/);
  assert.match(main, /leaderboardDialog\.showModal\(\)/);
  assert.match(leaderboardUi, /client\.fetchLeaderboard\(\{ limit: 100 \}\)/);
  assert.match(leaderboardUi, /leaderboard-replay-button/);
  assert.match(main, /new ReplayViewer/);
  assert.match(leaderboardUi, /leaderboard-login-hint/);
  assert.match(css, /#leaderboard-dialog\[open\]/);
  assert.match(css, /#leaderboard-dialog::backdrop/);
});

test('replay modal exposes atlas controls, draggable timeline, hitboxes and speed scaling', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const viewer = await readFile(new URL('../site/src/replay/replay-viewer.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../site/style.css', import.meta.url), 'utf8');

  for (const id of [
    'replay-play-pause',
    'replay-restart',
    'replay-hitbox',
    'replay-speed-1',
    'replay-speed-1-5',
    'replay-speed-2',
    'replay-speed-5',
    'replay-progress',
    'replay-progress-handle',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(viewer, /delta \* this\.playbackRate/);
  assert.match(viewer, /this\.hitboxes \? this\.game\.snapshot\(\) : null/);
  assert.match(viewer, /seekToStep\(targetStep\)/);
  assert.match(viewer, /button_pause/);
  assert.match(viewer, /button_resume/);
  assert.match(viewer, /bird2_0/);
  assert.match(viewer, /replay_progress_track/);
  assert.match(viewer, /replay_progress_filled/);
  assert.match(css, /\.replay-progress[\s\S]*width: 240px/);
  assert.match(css, /\.replay-atlas-button\.atlas-pressed \.replay-atlas-icon/);
  assert.match(css, /clip-path: inset\(0 0 var\(--atlas-source-pixel, 1px\) 0\)/);
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

    const leaderboard = new LeaderboardClient({
      ...config,
      getAccessToken: () => auth.accessToken(),
    });
    const result = await leaderboard.fetchMyLeaderboardContext();
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
  const leaderboardUi = await readFile(new URL('../site/src/ui/leaderboard-ui.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../site/style.css', import.meta.url), 'utf8');

  assert.match(html, /id="leaderboard-player-card"/);
  assert.match(html, /VOTRE CLASSEMENT/);
  assert.match(html, /id="leaderboard-player-rank"/);
  assert.match(html, /id="leaderboard-player-best"/);
  assert.match(html, /id="leaderboard-player-runs"/);
  assert.match(html, /id="leaderboard-player-record-date"/);
  assert.match(leaderboardUi, /client\.fetchMyLeaderboardContext\(\)/);
  assert.match(leaderboardUi, /PAS ENCORE CLASSÉ/);
  assert.match(leaderboardUi, /this\.context\.global_rank/);
  assert.match(css, /\.leaderboard-player-card/);
  assert.match(css, /\.leaderboard-player-metrics/);
});


test('profile customization propagates immediately into an already loaded leaderboard row', () => {
  const auth = { snapshot: () => ({ status: 'signed_in', user: { id: rows[0].player_id } }) };
  const ui = new LeaderboardUI({ auth, client: null, dialog: null, getElement: () => null });
  ui.rows = structuredClone(rows);
  ui.loadedAt = Date.now();
  ui.render = () => {};

  const changed = ui.applyProfile({
    id: rows[0].player_id,
    username: 'birdplayer',
    display_name: 'Nouveau Pseudo',
    avatar_url: null,
  });

  assert.equal(changed, true);
  assert.equal(ui.rows[0].display_name, 'Nouveau Pseudo');
  assert.equal(ui.rows[0].avatar_url, null);
  assert.equal(ui.loadedAt, 0, 'next remote leaderboard read must not reuse the stale minute cache');
});
