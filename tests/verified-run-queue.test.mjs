import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PENDING_VERIFIED_RUNS,
  VERIFIED_RUN_QUEUE_KEY,
  VerifiedRunQueue,
  enqueueVerifiedRun,
  pendingVerifiedRuns,
  pendingVerifiedRunsForPlayer,
  removePendingVerifiedRun,
  repairPendingVerifiedRunQueue,
} from '../site/src/session/verified-run-queue.js';
import { PHYSICS_VERSION } from '../site/src/verified-runs.js';

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

function submission(runId = RUN_ID) {
  return {
    schema: 'flappy13-verified-run-v1',
    run_id: runId,
    physics_version: PHYSICS_VERSION,
    terminal_tick: 53,
    taps: [0],
  };
}

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

test('VerifiedRunQueue wraps one storage backend behind a focused repository API', () => {
  const storage = new MemoryStorage();
  const queue = new VerifiedRunQueue({ storage });

  assert.equal(queue.enqueue(submission(), { playerId: PLAYER_ONE }), 1);
  assert.equal(queue.all().length, 1);
  assert.equal(queue.forPlayer(PLAYER_ONE).length, 1);
  assert.equal(queue.remove(RUN_ID), 0);
  assert.deepEqual(queue.repair(), []);
});
