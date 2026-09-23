import assert from 'node:assert/strict';
import test from 'node:test';

import { GameTransitionController } from '../site/src/ui/game-transition.js';

function game() {
  return {
    fade: { done: true, value: 0 },
    transitions: [],
    transition(...args) {
      this.transitions.push(args);
      if (args[0]) {
        this.fade.done = false;
      }
    },
  };
}

test('game transition starts the native fade and preserves its minimum duration', async () => {
  const origin = game();
  let current = true;
  let now = 1000;
  let swooshes = 0;
  const transition = new GameTransitionController({
    durationSeconds: 0.5,
    isCurrentGame: candidate => current && candidate === origin,
    playSwoosh: () => swooshes++,
    now: () => now,
    sleep: async () => {
      now += 250;
      if (now >= 1500) {
        origin.fade.done = true;
        origin.fade.value = 1;
      }
    },
  });

  const startedAt = transition.startToBlack(origin);
  assert.equal(startedAt, 1000);
  assert.deepEqual(origin.transitions, [[true, 0, 0.5]]);
  assert.equal(swooshes, 1);
  assert.equal(await transition.ensureBlack(origin, startedAt), true);
  assert.ok(now >= 1500);

  current = false;
  assert.equal(await transition.ensureBlack(origin, null), false);
});

test('game transition restores a fully black menu with the native reveal fade', () => {
  const origin = game();
  origin.fade.value = 1;
  let resets = 0;
  const transition = new GameTransitionController({
    durationSeconds: 0.5,
    isCurrentGame: candidate => candidate === origin,
    resetClock: () => resets++,
  });

  assert.equal(transition.restoreFromBlack(origin), true);
  assert.deepEqual(origin.transitions, [[false, 0, 0.5]]);
  assert.equal(resets, 1);
});
