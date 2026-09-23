import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VerifiedRunSubmitter,
  shouldDiscardVerifiedRunSubmission,
} from '../site/src/session/verified-run-submit.js';

const PLAYER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function queueOf(...submissions) {
  const items = submissions.map(submission => ({ submission }));
  const removed = [];
  return {
    removed,
    forPlayer: playerId => playerId === PLAYER_ID ? items : [],
    remove: runId => {
      removed.push(runId);
      return 0;
    },
  };
}

function run(runId) {
  return { run_id: runId, taps: [0] };
}

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

test('submitter drains resolved runs and reports the highest verified score', async () => {
  const first = run('123e4567-e89b-12d3-a456-426614174000');
  const second = run('223e4567-e89b-12d3-a456-426614174000');
  const queue = queueOf(first, second);
  const responses = [
    { status: 'verified', run_id: first.run_id, score: 7 },
    { status: 'rejected', run_id: second.run_id, score: 0 },
  ];
  const submitter = new VerifiedRunSubmitter({
    queue,
    api: { submit: async () => responses.shift() },
  });

  const result = await submitter.flushForPlayer(PLAYER_ID, { reason: 'test' });

  assert.equal(result.verified, 1);
  assert.equal(result.rejected, 1);
  assert.equal(result.discarded, 0);
  assert.equal(result.deferred, false);
  assert.equal(result.highestVerifiedScore, 7);
  assert.equal(result.lastResult.status, 'rejected');
  assert.deepEqual(queue.removed, [first.run_id, second.run_id]);
});

test('submitter discards permanent failures but stops FIFO on transient failures', async () => {
  const first = run('123e4567-e89b-12d3-a456-426614174000');
  const second = run('223e4567-e89b-12d3-a456-426614174000');
  const third = run('323e4567-e89b-12d3-a456-426614174000');
  const queue = queueOf(first, second, third);
  let calls = 0;
  const submitter = new VerifiedRunSubmitter({
    queue,
    api: {
      submit: async () => {
        calls++;
        if (calls === 1) throw { status: 404, code: 'run_not_found' };
        throw { status: 503, code: 'temporarily_unavailable' };
      },
    },
  });

  const result = await submitter.flushForPlayer(PLAYER_ID, { reason: 'online' });

  assert.equal(result.discarded, 1);
  assert.equal(result.deferred, true);
  assert.equal(calls, 2);
  assert.deepEqual(queue.removed, [first.run_id]);
});
