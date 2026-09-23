import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { AuthClient } from '../site/src/auth.js';
import { LeaderboardClient } from '../site/src/api/leaderboard-client.js';
import { parsePlayerPerformanceStats } from '../site/src/leaderboard.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function installNavigator(online = true) {
  const previous = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: online } });
  return () => {
    if (previous === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous });
  };
}

const playerId = '323e4567-e89b-12d3-a456-426614174000';
const payload = [{
  player_id: playerId,
  verified_runs_count: 736,
  total_score: 12342,
  career_average: '16.7690217391304348',
  best_score: 184,
  first_verified_run_at: '2026-01-01T00:00:00Z',
  last_verified_run_at: '2026-09-21T00:00:00Z',
  recent_10_count: 10,
  recent_10_average: '35.1', recent_10_best: 72, recent_10_median: 33, recent_10_stddev: '8.2',
  recent_25_count: 25,
  recent_25_average: '31.2', recent_25_best: 92, recent_25_median: 28, recent_25_stddev: '12.3',
  recent_50_count: 50,
  recent_50_average: '28.4', recent_50_best: 92, recent_50_median: 24, recent_50_stddev: '14.8',
  recent_50_vs_career_pct: '69.3618103727714748',
}];

test('player performance parser normalizes career and 10/25/50 windows', () => {
  const stats = parsePlayerPerformanceStats(payload);
  assert.equal(stats.player_id, playerId);
  assert.equal(stats.verified_runs_count, 736);
  assert.equal(stats.total_score, 12342);
  assert.equal(stats.career_average, Number(payload[0].career_average));
  assert.deepEqual(stats.recent_10, { count: 10, average: 35.1, best: 72, median: 33, stddev: 8.2 });
  assert.equal(stats.recent_50.count, 50);
  assert.equal(stats.recent_50_vs_career_pct, Number(payload[0].recent_50_vs_career_pct));
});

test('player performance RPC is authenticated and caller-only', async () => {
  const restoreNavigator = installNavigator(true);
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const auth = new AuthClient({
      url: 'https://project-ref.supabase.co',
      publishableKey: 'sb_publishable_test',
      storage: new MemoryStorage(),
    });
    auth.session = { accessToken: 'access', refreshToken: 'refresh', tokenType: 'bearer', expiresAt: Date.now() + 3600000 };
    auth.user = { id: playerId };
    const leaderboard = new LeaderboardClient({
      url: 'https://project-ref.supabase.co',
      publishableKey: 'sb_publishable_test',
      getAccessToken: () => auth.accessToken(),
    });
    const stats = await leaderboard.fetchMyPlayerPerformanceStats();
    assert.equal(stats.recent_25.average, 31.2);
    assert.equal(request.url, 'https://project-ref.supabase.co/rest/v1/rpc/get_my_player_performance_stats');
    assert.equal(request.init.headers.Authorization, 'Bearer access');
    assert.deepEqual(JSON.parse(request.init.body), {});
  } finally {
    globalThis.fetch = previousFetch;
    restoreNavigator();
  }
});

test('performance SQL uses lifetime aggregates plus only the 50 most recent retained verified runs', async () => {
  const sql = await readFile(new URL('../supabase/008_player_performance_stats.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace function public\.get_my_player_performance_stats\(\)/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /join public\.player_stats as ps/i);
  assert.match(sql, /from public\.verified_runs as vr/i);
  assert.match(sql, /vr\.status = 'verified'/i);
  assert.match(sql, /order by vr\.issued_at desc, vr\.run_id desc/i);
  assert.match(sql, /where r\.recent_rank <= 50/i);
  assert.match(sql, /percentile_cont\(0\.5\)/i);
  assert.match(sql, /stddev_pop/i);
  assert.match(sql, /grant execute on function public\.get_my_player_performance_stats\(\) to authenticated, service_role/i);
  assert.match(sql, /revoke all on function public\.get_my_player_performance_stats\(\) from public, anon/i);
});

test('leaderboard modal exposes career and recent performance blocks', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const leaderboardUi = await readFile(new URL('../site/src/ui/leaderboard-ui.js', import.meta.url), 'utf8');
  assert.match(html, /<details id="leaderboard-stats-card"[^>]*>/);
  assert.match(html, /<summary class="leaderboard-stats-summary">/);
  assert.match(html, /leaderboard-stats-chevron/);
  assert.match(html, /VOS STATISTIQUES/);
  assert.match(html, /MOY\. CARRIÈRE/);
  assert.match(html, /TENDANCE 50/);
  assert.match(html, /id="stats-10-average"/);
  assert.match(html, /id="stats-25-average"/);
  assert.match(html, /id="stats-50-average"/);
  assert.match(leaderboardUi, /client\.fetchMyPlayerPerformanceStats\(\)/);
  assert.match(leaderboardUi, /recent_50_vs_career_pct/);
});
