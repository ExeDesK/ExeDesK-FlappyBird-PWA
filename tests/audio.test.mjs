import assert from 'node:assert/strict';
import test from 'node:test';

import { Audio } from '../site/src/audio.js';

function installDom({ AudioContextType = null } = {}) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.document = {
    visibilityState: 'visible',
    hasFocus: () => true,
  };
  globalThis.window = {};
  if (AudioContextType) globalThis.window.AudioContext = AudioContextType;
  return () => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  };
}

class FakeContext {
  constructor(state = 'suspended', { resumeTo = 'running', decodeDelay = 0 } = {}) {
    this.state = state;
    this.resumeTo = resumeTo;
    this.decodeDelay = decodeDelay;
    this.resumeCalls = 0;
    this.closeCalls = 0;
    this.sampleRate = 48000;
    this.listeners = new Map();
    this.started = [];
    this.destination = {};
  }

  addEventListener(type, fn) {
    this.listeners.set(type, fn);
  }

  _emit(type) {
    this.listeners.get(type)?.();
  }

  resume() {
    this.resumeCalls += 1;
    this.state = this.resumeTo;
    this._emit('statechange');
    return Promise.resolve();
  }

  close() {
    this.closeCalls += 1;
    this.state = 'closed';
    this._emit('statechange');
    return Promise.resolve();
  }

  async decodeAudioData(raw) {
    if (this.decodeDelay) await new Promise(resolve => setTimeout(resolve, this.decodeDelay));
    return { bytes: raw.byteLength };
  }

  createBufferSource() {
    const context = this;
    return {
      buffer: null,
      connect() {},
      start() {
        context.started.push(this.buffer);
      },
    };
  }
}

function addRaw(audio) {
  for (const name of ['wing', 'point', 'hit', 'die', 'swooshing']) {
    audio.raw.set(name, new Uint8Array([1, 2, 3]).buffer);
  }
}

test('foreground recovery resumes an interrupted context when Safari allows it', async () => {
  const restore = installDom();
  try {
    const audio = new Audio({ version: 'test' });
    const context = new FakeContext('interrupted');
    audio.context = context;

    audio.recover('visibility-visible');
    await audio.resumePromise;

    assert.equal(context.resumeCalls, 1);
    assert.equal(context.state, 'running');
    assert.equal(audio.hardRecoveryNeeded, false);
    assert.ok(audio.events.some(event =>
      event.type === 'RESUME_REQUEST' && event.detail.from === 'interrupted'));
    assert.ok(audio.events.some(event => event.type === 'RESUME_OK'));
  } finally {
    restore();
  }
});

test('a user gesture hard-recreates an iOS context still interrupted after device lock', async () => {
  const created = [];
  class ReplacementContext extends FakeContext {
    constructor() {
      super('suspended');
      created.push(this);
    }
  }

  const restore = installDom({ AudioContextType: ReplacementContext });
  try {
    const audio = new Audio({ version: 'test' });
    addRaw(audio);
    const old = new FakeContext('interrupted', { resumeTo: 'interrupted' });
    audio.context = old;
    audio.hardRecoveryNeeded = true;

    audio.unlock('game-input');
    await audio.recoveryPromise;

    assert.equal(created.length, 1);
    assert.notEqual(audio.context, old);
    assert.equal(old.closeCalls, 1);
    assert.equal(audio.context.state, 'running');
    assert.equal(audio.buffers.size, 5);
    assert.equal(audio.hardRecoveryNeeded, false);
    assert.ok(audio.events.some(event => event.type === 'HARD_RECOVERY_REQUEST'));
    assert.ok(audio.events.some(event => event.type === 'CONTEXT_RECREATED'));
    assert.ok(audio.events.some(event => event.type === 'HARD_RECOVERY_OK'));
  } finally {
    restore();
  }
});

test('first SFX after lock recovery is queued then played after buffers are decoded', async () => {
  const created = [];
  class ReplacementContext extends FakeContext {
    constructor() {
      super('suspended', { decodeDelay: 5 });
      created.push(this);
    }
  }

  const restore = installDom({ AudioContextType: ReplacementContext });
  try {
    const audio = new Audio({ version: 'test' });
    addRaw(audio);
    audio.context = new FakeContext('interrupted', { resumeTo: 'interrupted' });
    audio.hardRecoveryNeeded = true;

    audio.unlock('game-input');
    audio.play('wing');
    await audio.recoveryPromise;

    assert.equal(created.length, 1);
    assert.equal(created[0].started.length, 1);
    assert.equal(audio.pendingSound, null);
    assert.equal(audio.lastSoundResult, 'started');
    assert.ok(audio.events.some(event => event.type === 'SFX_QUEUED'));
    assert.ok(audio.events.some(event => event.type === 'SFX_FLUSHED'));
  } finally {
    restore();
  }
});

test('resolved resume that remains interrupted requests hard recovery for next gesture', async () => {
  const restore = installDom();
  try {
    const audio = new Audio({ version: 'test' });
    const context = new FakeContext('interrupted', { resumeTo: 'interrupted' });
    audio.context = context;

    audio.recover('visibility-visible');
    await audio.resumePromise;

    assert.equal(context.resumeCalls, 1);
    assert.equal(context.state, 'interrupted');
    assert.equal(audio.hardRecoveryNeeded, true);
    assert.ok(audio.events.some(event => event.type === 'RESUME_STUCK'));
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
