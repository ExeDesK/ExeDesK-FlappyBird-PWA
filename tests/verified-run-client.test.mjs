import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PENDING_VERIFIED_RUNS,
  VERIFIED_RUN_QUEUE_KEY,
  VerifiedRunRecorder,
  enqueueVerifiedRun,
  isPlayRelease,
  pendingVerifiedRuns,
  pendingVerifiedRunsForPlayer,
  removePendingVerifiedRun,
  repairPendingVerifiedRunQueue,
  shouldDiscardVerifiedRunSubmission,
  verifiedRunStartMode,
} from '../site/src/verified-run-client.js';
import {
  PHYSICS_VERSION,
  RUN_TICKET_SCHEMA,
  VERIFIED_RUN_TAP,
  createCanonicalRunGame,
} from '../site/src/verified-runs.js';

const RUN_ID = '123e4567-e89b-12d3-a456-426614174000';
const PLAYER_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAYER_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

function submission(runId = RUN_ID) {
  return {
    schema: 'flappy13-verified-run-v1',
    run_id: runId,
    physics_version: PHYSICS_VERSION,
    terminal_tick: 53,
    taps: [0],
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
  let recordedSubmission = null;

  for (let tick = 0; tick < 100 && !recordedSubmission; tick++) {
    const input = tick === 0 ? { tap: VERIFIED_RUN_TAP } : {};
    recorder.beforeTick(game, input);
    game.tick(input);
    recordedSubmission = recorder.afterTick(game);
  }

  assert.deepEqual(recordedSubmission, {
    schema: 'flappy13-verified-run-v1',
    run_id: RUN_ID,
    physics_version: PHYSICS_VERSION,
    terminal_tick: 53,
    taps: [0],
  });
  assert.equal('seed' in recordedSubmission, false);
  assert.equal('score' in recordedSubmission, false);
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
      playerId: PLAYER_ONE,
      queuedAt: `2026-09-20T18:00:${String(index).padStart(2, '0')}.000Z`,
    });
  }

  const queue = pendingVerifiedRuns(storage);
  assert.equal(queue.length, MAX_PENDING_VERIFIED_RUNS);
  assert.equal(queue[0].submission.run_id, '123e4567-e89b-12d3-a456-000000000002');

  const last = queue.at(-1).submission;
  enqueueVerifiedRun(last, {
    storage,
    playerId: PLAYER_ONE,
    queuedAt: '2026-09-20T19:00:00.000Z',
  });
  const deduplicated = pendingVerifiedRuns(storage);
  assert.equal(deduplicated.length, MAX_PENDING_VERIFIED_RUNS);
  assert.equal(deduplicated.at(-1).queued_at, '2026-09-20T19:00:00.000Z');
  assert.ok(storage.getItem(VERIFIED_RUN_QUEUE_KEY));
});

test('offline queue keeps account ownership local and removes one resolved run', () => {
  const storage = new MemoryStorage();
  const runOne = RUN_ID;
  const runTwo = '223e4567-e89b-12d3-a456-426614174000';

  enqueueVerifiedRun(submission(runOne), { storage, playerId: PLAYER_ONE });
  enqueueVerifiedRun(submission(runTwo), { storage, playerId: PLAYER_TWO });

  assert.deepEqual(
    pendingVerifiedRunsForPlayer(PLAYER_ONE, storage)
      .map(item => item.submission.run_id),
    [runOne],
  );
  assert.deepEqual(
    pendingVerifiedRunsForPlayer(PLAYER_TWO, storage)
      .map(item => item.submission.run_id),
    [runTwo],
  );
  assert.equal(removePendingVerifiedRun(runOne, { storage }), 1);
  assert.deepEqual(
    pendingVerifiedRuns(storage).map(item => item.submission.run_id),
    [runTwo],
  );
});

test('queue repair removes ownerless and malformed legacy poison pills and keeps the newest duplicate', () => {
  const storage = new MemoryStorage();
  const runOne = RUN_ID;
  const runTwo = '223e4567-e89b-12d3-a456-426614174000';
  const ownerlessRun = '323e4567-e89b-12d3-a456-426614174000';
  const malformedRun = '423e4567-e89b-12d3-a456-426614174000';

  storage.setItem(VERIFIED_RUN_QUEUE_KEY, JSON.stringify([
    {
      queued_at: '2026-09-20T18:00:00.000Z',
      player_id: null,
      submission: submission(ownerlessRun),
    },
    {
      queued_at: '2026-09-20T18:01:00.000Z',
      player_id: PLAYER_ONE,
      submission: submission(runOne),
    },
    {
      queued_at: 'invalid-date',
      player_id: PLAYER_ONE,
      submission: submission(malformedRun),
    },
    {
      queued_at: '2026-09-20T18:02:00.000Z',
      player_id: PLAYER_ONE,
      submission: submission(runOne),
    },
    {
      queued_at: '2026-09-20T18:03:00.000Z',
      player_id: PLAYER_TWO,
      submission: submission(runTwo),
    },
  ]));

  const repaired = repairPendingVerifiedRunQueue(storage);
  assert.deepEqual(
    repaired.map(item => item.submission.run_id),
    [runOne, runTwo],
  );
  assert.equal(repaired[0].queued_at, '2026-09-20T18:02:00.000Z');
  assert.deepEqual(
    pendingVerifiedRunsForPlayer(PLAYER_ONE, storage)
      .map(item => item.submission.run_id),
    [runOne],
  );
  assert.deepEqual(
    pendingVerifiedRunsForPlayer(PLAYER_TWO, storage)
      .map(item => item.submission.run_id),
    [runTwo],
  );
});

test('new queued verified runs require a valid player owner', () => {
  const storage = new MemoryStorage();

  assert.throws(
    () => enqueueVerifiedRun(submission(), { storage }),
    /player_id requis/,
  );
  assert.throws(
    () => enqueueVerifiedRun(submission(), { storage, playerId: 'not-a-uuid' }),
    /player_id invalide/,
  );
  assert.deepEqual(pendingVerifiedRuns(storage), []);
});

test('only permanent submission failures discard a queued run', () => {
  for (const status of [400, 409, 413, 422]) {
    assert.equal(shouldDiscardVerifiedRunSubmission({ status }), true);
  }

  assert.equal(
    shouldDiscardVerifiedRunSubmission({ status: 404, code: 'run_not_found' }),
    true,
  );
  assert.equal(
    shouldDiscardVerifiedRunSubmission({ status: 404, code: 'other_error' }),
    false,
  );
  assert.equal(shouldDiscardVerifiedRunSubmission({ status: 429 }), false);
  assert.equal(shouldDiscardVerifiedRunSubmission({ status: 500 }), false);
  assert.equal(shouldDiscardVerifiedRunSubmission(new TypeError('offline')), false);
});
