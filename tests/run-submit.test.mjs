import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  inspectRunPayload,
  verifyInspectedRun,
} from '../supabase/functions/_shared/run-verifier.js';

const RUN_ID = '123e4567-e89b-12d3-a456-426614174000';
const PHYSICS_VERSION = 'flappy13-physics-v1';

function submission(overrides = {}) {
  return {
    schema: 'flappy13-verified-run-v1',
    run_id: RUN_ID,
    physics_version: PHYSICS_VERSION,
    terminal_tick: 53,
    taps: [0],
    ...overrides,
  };
}

test('run-submit verifier authoritatively accepts the canonical ground replay', async () => {
  const inspection = await inspectRunPayload(submission());
  const resolution = verifyInspectedRun({
    inspection,
    seed: 42,
    ticketPhysicsVersion: PHYSICS_VERSION,
  });

  assert.match(inspection.replay_hash, /^[0-9a-f]{64}$/);
  assert.equal(resolution.status, 'verified');
  assert.equal(resolution.verified_score, 0);
  assert.equal(resolution.collision, 'ground');
  assert.equal(resolution.terminal_tick, 53);
  assert.deepEqual(resolution.tap_ticks, [0]);
  assert.equal(resolution.rejection_code, null);
});

test('run-submit verifier rejects a replay that claims a late collision', async () => {
  const inspection = await inspectRunPayload(submission({ terminal_tick: 54 }));
  const resolution = verifyInspectedRun({
    inspection,
    seed: 42,
    ticketPhysicsVersion: PHYSICS_VERSION,
  });

  assert.equal(resolution.status, 'rejected');
  assert.equal(resolution.rejection_code, 'early_collision');
  assert.equal(resolution.verified_score, null);
  assert.equal(resolution.collision, null);
});

test('reserved client fields are rejected before authoritative simulation', async () => {
  const inspection = await inspectRunPayload(submission({ score: 999999 }));
  const resolution = verifyInspectedRun({
    inspection,
    seed: 42,
    ticketPhysicsVersion: PHYSICS_VERSION,
  });

  assert.equal(inspection.submission, null);
  assert.equal(resolution.status, 'rejected');
  assert.equal(resolution.rejection_code, 'invalid_submission');
  assert.equal(resolution.terminal_tick, null);
  assert.equal(resolution.tap_ticks, null);
});

test('client submissions cannot carry player statistics or any extra field', async () => {
  const inspection = await inspectRunPayload(submission({
    verified_runs_count: 999,
    total_score: 999999,
    best_score: 999999,
  }));
  const resolution = verifyInspectedRun({
    inspection,
    seed: 42,
    ticketPhysicsVersion: PHYSICS_VERSION,
  });

  assert.equal(inspection.submission, null);
  assert.equal(resolution.status, 'rejected');
  assert.equal(resolution.rejection_code, 'invalid_submission');
});

test('canonical replay hash is independent from JSON property order', async () => {
  const first = await inspectRunPayload(submission());
  const second = await inspectRunPayload({
    taps: [0],
    terminal_tick: 53,
    physics_version: PHYSICS_VERSION,
    run_id: RUN_ID,
    schema: 'flappy13-verified-run-v1',
  });

  assert.equal(first.replay_hash, second.replay_hash);
});

test('run-submit authenticates ownership and resolves one issued row atomically', async () => {
  const source = await readFile(
    new URL('../supabase/functions/run-submit/index.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /withSupabase\(\{ auth: 'user' \}/);
  assert.match(source, /context\.userClaims\?\.id/);
  assert.match(source, /\.eq\('player_id', playerId\)/);
  assert.match(source, /\.eq\('status', 'issued'\)/);
  assert.match(source, /ticket\.replay_hash === inspection\.replay_hash/);
  assert.match(source, /MAX_REQUEST_BYTES = 4 \* 1024 \* 1024/);
  assert.match(source, /verifyInspectedRun/);
  assert.doesNotMatch(source, /payload\??\.score/);
});
