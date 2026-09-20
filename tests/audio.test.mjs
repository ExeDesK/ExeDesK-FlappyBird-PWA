import assert from 'node:assert/strict';
import test from 'node:test';

import { Audio } from '../site/src/audio.js';

function installDom() {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.document = {
    visibilityState: 'visible',
    hasFocus: () => true,
  };
  globalThis.window = {};
  return () => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  };
}

class FakeContext {
  constructor(state) {
    this.state = state;
    this.resumeCalls = 0;
  }

  resume() {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }
}

test('iOS interrupted AudioContext is resumed by the next user gesture', async () => {
  const restore = installDom();
  try {
    const audio = new Audio({ version: 'test' });
    const context = new FakeContext('interrupted');
    audio.context = context;

    audio.unlock('game-input');
    await audio.resumePromise;

    assert.equal(context.resumeCalls, 1);
    assert.equal(context.state, 'running');
    assert.ok(audio.events.some(event =>
      event.type === 'RESUME_REQUEST' && event.detail.from === 'interrupted'));
    assert.ok(audio.events.some(event => event.type === 'RESUME_OK'));
  } finally {
    restore();
  }
});

test('foreground recovery also attempts to resume an interrupted context', async () => {
  const restore = installDom();
  try {
    const audio = new Audio({ version: 'test' });
    const context = new FakeContext('interrupted');
    audio.context = context;

    audio.recover('visibility-visible');
    await audio.resumePromise;

    assert.equal(context.resumeCalls, 1);
    assert.equal(context.state, 'running');
  } finally {
    restore();
  }
});

test('running AudioContext is not resumed unnecessarily', () => {
  const restore = installDom();
  try {
    const audio = new Audio({ version: 'test' });
    const context = new FakeContext('running');
    audio.context = context;

    audio.unlock('game-input');

    assert.equal(context.resumeCalls, 0);
    assert.equal(audio.resumePromise, null);
  } finally {
    restore();
  }
});
