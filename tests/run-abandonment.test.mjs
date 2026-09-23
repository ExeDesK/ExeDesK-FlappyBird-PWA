import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { VerifiedRunClient } from '../site/src/api/verified-run-api.js';
import { VerifiedPlayController } from '../site/src/session/verified-play.js';

const migrationUrl = new URL('../supabase/011_verified_run_abandonment.sql', import.meta.url);
const RUN_ID = '123e4567-e89b-12d3-a456-426614174000';
const PLAYER_ID = '223e4567-e89b-12d3-a456-426614174000';

async function migration() {
  return readFile(migrationUrl, 'utf8');
}

test('READY abandonment has an authenticated owner-only RPC that deletes only issued tickets', async () => {
  const sql = await migration();

  assert.match(sql, /create or replace function public\.cancel_verified_run\(target_run_id uuid\)/i);
  assert.match(sql, /caller_id uuid := auth\.uid\(\)/i);
  assert.match(sql, /delete from public\.verified_runs as vr[\s\S]*vr\.run_id = target_run_id[\s\S]*vr\.player_id = caller_id[\s\S]*vr\.status = 'issued'/i);
  assert.match(sql, /grant execute on function public\.cancel_verified_run\(uuid\)[\s\S]*to authenticated, service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.cancel_verified_run\(uuid\)[\s\S]{0,80}to anon/i);
});

test('current issuance never rejects because of pending-row count and rotates only at a generous ceiling', async () => {
  const sql = await migration();

  assert.match(sql, /max_open_issued constant integer := 100/i);
  assert.match(sql, /if open_issued >= max_open_issued/i);
  assert.match(sql, /order by vr\.issued_at asc, vr\.run_id asc/i);
  assert.match(sql, /limit \(open_issued - \(max_open_issued - 1\)\)/i);
  assert.doesNotMatch(sql, /too_many_pending_runs/i);
  assert.match(sql, /if starts_last_minute >= 30/i);
  assert.match(sql, /'rate_limited'::text/i);
});

test('VerifiedRunClient cancels an issued ticket through the authenticated Supabase RPC', async () => {
  const previousFetch = globalThis.fetch;
  const previousNavigator = globalThis.navigator;
  const requests = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response('true', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const client = new VerifiedRunClient({
      url: 'https://project-ref.supabase.co',
      publishableKey: 'publishable',
      getAccessToken: () => 'access-token',
    });

    const result = await client.cancel(RUN_ID);
    assert.deepEqual(result, { run_id: RUN_ID, cancelled: true });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://project-ref.supabase.co/rest/v1/rpc/cancel_verified_run');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer access-token');
    assert.deepEqual(JSON.parse(requests[0].options.body), { target_run_id: RUN_ID });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNavigator === undefined) {
      delete globalThis.navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: previousNavigator,
      });
    }
  }
});

test('VerifiedPlayController releases the unfinished ticket when READY is abandoned', async () => {
  const previousNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });
  const cancelled = [];

  try {
    const controller = new VerifiedPlayController({
      auth: { session: { accessToken: 'x' }, user: { id: PLAYER_ID } },
      api: {
        cancel: async runId => {
          cancelled.push(runId);
          return { run_id: runId, cancelled: true };
        },
      },
      queue: { all: () => [] },
      submitter: {},
      transition: {},
      warning: {},
    });

    controller.recorder = {
      finished: false,
      snapshot: () => ({
        run_id: RUN_ID,
        physics_version: 'flappy13-physics-v1',
        terminal_tick: null,
        taps: [],
      }),
    };

    const result = await controller.abandon({ reason: 'home-from-ready' });
    assert.equal(result.cancelled, true);
    assert.deepEqual(cancelled, [RUN_ID]);
    assert.equal(controller.recorder, null);
    assert.equal(controller.snapshot().status, 'abandoned');
    assert.equal(controller.snapshot().reason, 'home-from-ready');
  } finally {
    if (previousNavigator === undefined) {
      delete globalThis.navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: previousNavigator,
      });
    }
  }
});

test('Home navigation explicitly abandons the active verified ticket', async () => {
  const source = await readFile(new URL('../site/src/main.js', import.meta.url), 'utf8');
  assert.match(source, /void verifiedPlay\.abandon\(\{ reason: 'home-from-ready-or-game-over' \}\)/);
});
