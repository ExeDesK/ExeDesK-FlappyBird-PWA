import assert from 'node:assert/strict';
import test from 'node:test';

import { VerifiedRunRecorder } from '../site/src/replay/verified-run-recorder.js';
import {
  PHYSICS_VERSION,
  RUN_TICKET_SCHEMA,
  VERIFIED_RUN_TAP,
  createCanonicalRunGame,
} from '../site/src/verified-runs.js';

const RUN_ID = '123e4567-e89b-12d3-a456-426614174000';

function ticket(seed = 42, runId = RUN_ID) {
  return {
    schema: RUN_TICKET_SCHEMA,
    run_id: runId,
    seed,
    physics_version: PHYSICS_VERSION,
    issued_at: '2026-09-20T18:00:00.000Z',
  };
}

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

test('new verified runs carry replay-only visual context without changing physics inputs', () => {
  const runTicket = ticket(42);
  const { game } = createCanonicalRunGame({ seed: runTicket.seed });
  const recorder = new VerifiedRunRecorder(runTicket, {
    visualContext: { theme: 'france', variant: 'night' },
  });
  let submission = null;

  for (let tick = 0; tick < 100 && !submission; tick++) {
    const input = tick === 0 ? { tap: VERIFIED_RUN_TAP } : {};
    recorder.beforeTick(game, input);
    game.tick(input);
    submission = recorder.afterTick(game);
  }

  assert.deepEqual(submission.visual_context, { theme: 'france', variant: 'night' });
  assert.equal('seed' in submission, false);
  assert.equal('score' in submission, false);
});
