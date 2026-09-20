import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PENDING_VERIFIED_RUNS,
  VERIFIED_RUN_QUEUE_KEY,
  VerifiedRunRecorder,
  enqueueVerifiedRun,
  isPlayRelease,
  pendingVerifiedRuns,
  verifiedRunStartMode,
} from '../site/src/verified-run-client.js';
import {
  PHYSICS_VERSION,
  RUN_TICKET_SCHEMA,
  VERIFIED_RUN_TAP,
  createCanonicalRunGame,
} from '../site/src/verified-runs.js';

const RUN_ID = '123e4567-e89b-12d3-a456-426614174000';

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

function ticket(seed = 42, runId = RUN_ID) {
  return {
    schema: RUN_TICKET_SCHEMA,
    run_id: runId,
    seed,
    physics_version: PHYSICS_VERSION,
    issued_at: '2026-09-20T18:00:00.000Z',
  };
}

test('only a Discord session gates PLAY behind a ticket or offline warning', () => {
  assert.equal(verifiedRunStartMode({ hasSession: false, online: true }), 'local');
  assert.equal(verifiedRunStartMode({ hasSession: false, online: false }), 'local');
  assert.equal(verifiedRunStartMode({ hasSession: true, online: true }), 'ticket');
  assert.equal(verifiedRunStartMode({ hasSession: true, online: false }), 'warn-offline');
});

test('PLAY release detection preserves the original strict hitbox', () => {
  const game = { play: { active: true, pressed: true, x: 20, y: 340, w: 116, h: 70 } };

  assert.equal(isPlayRelease(game, { touches: [{ x: 78, y: 375 }] }), false);
  assert.equal(isPlayRelease(game, { touches: [] }), true);
  assert.equal(isPlayRelease({ play: { ...game.play, pressed: false } }, { touches: [] }), false);
});

test('client recorder produces the canonical sparse submission through collision', () => {
  const runTicket = ticket(42);
  const { game } = createCanonicalRunGame({ seed: runTicket.seed });
  const recorder = new VerifiedRunRecorder(runTicket);
  let submission = null;

  for (let tick = 0; tick < 100 && !submission; tick++) {
    const input = tick === 0 ? { tap: VERIFIED_RUN_TAP } : {};
    recorder.beforeTick(game, input);
    game.tick(input);
    submission = recorder.afterTick(game);
  }

  assert.deepEqual(submission, {
    schema: 'flappy13-verified-run-v1',
    run_id: RUN_ID,
    physics_version: PHYSICS_VERSION,
    terminal_tick: 53,
    taps: [0],
  });
  assert.equal('seed' in submission, false);
  assert.equal('score' in submission, false);
  assert.equal(recorder.snapshot().finished, true);
});

test('READY waiting time and ignored pause-zone taps do not shift tick zero', () => {
  const runTicket = ticket(42);
  const { game } = createCanonicalRunGame({ seed: runTicket.seed });
  const recorder = new VerifiedRunRecorder(runTicket);

  for (let index = 0; index < 120; index++) {
    recorder.beforeTick(game, {});
    game.tick({});
  }

  const ignored = { tap: { x: 10, y: 10 } };
  recorder.beforeTick(game, ignored);
  game.tick(ignored);
  assert.equal(recorder.snapshot().started, false);

  const start = { tap: VERIFIED_RUN_TAP };
  recorder.beforeTick(game, start);
  game.tick(start);
  assert.deepEqual(recorder.snapshot().taps, [0]);
  assert.equal(recorder.snapshot().tick, 0);
});

test('completed submissions are deduplicated and bounded in the offline queue', () => {
  const storage = new MemoryStorage();

  for (let index = 0; index < MAX_PENDING_VERIFIED_RUNS + 2; index++) {
    const suffix = index.toString(16).padStart(12, '0');
    enqueueVerifiedRun({
      schema: 'flappy13-verified-run-v1',
      run_id: `123e4567-e89b-12d3-a456-${suffix}`,
      physics_version: PHYSICS_VERSION,
      terminal_tick: 53,
      taps: [0],
    }, {
      storage,
      queuedAt: `2026-09-20T18:00:${String(index).padStart(2, '0')}.000Z`,
    });
  }

  const queue = pendingVerifiedRuns(storage);
  assert.equal(queue.length, MAX_PENDING_VERIFIED_RUNS);
  assert.equal(queue[0].submission.run_id, '123e4567-e89b-12d3-a456-000000000002');

  const last = queue.at(-1).submission;
  enqueueVerifiedRun(last, { storage, queuedAt: '2026-09-20T19:00:00.000Z' });
  const deduplicated = pendingVerifiedRuns(storage);
  assert.equal(deduplicated.length, MAX_PENDING_VERIFIED_RUNS);
  assert.equal(deduplicated.at(-1).queued_at, '2026-09-20T19:00:00.000Z');
  assert.ok(storage.getItem(VERIFIED_RUN_QUEUE_KEY));
});
