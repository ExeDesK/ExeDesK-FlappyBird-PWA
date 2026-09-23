import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPlayRelease,
  verifiedRunStartMode,
} from '../site/src/verified-run-client.js';

test('only an authenticated session gates PLAY behind a ticket or offline warning', () => {
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
