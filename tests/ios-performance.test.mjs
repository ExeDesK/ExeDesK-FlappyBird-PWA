import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { Audio } from '../site/src/audio.js';
import { PerfProfiler } from '../site/src/perf.js';

class RunningContext {
  constructor() {
    this.state = 'running';
    this.resumeCalls = 0;
  }

  resume() {
    this.resumeCalls += 1;
    return Promise.resolve();
  }
}

test('running audio context uses the steady-state unlock fast path', () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { visibilityState: 'visible', hasFocus: () => true };
  globalThis.window = {};

  try {
    const audio = new Audio({ version: 'test' });
    audio.context = new RunningContext();
    const before = audio.events.length;

    assert.equal(audio.needsUnlock(), false);
    assert.equal(audio.unlock('game-input'), true);
    assert.equal(audio.context.resumeCalls, 0);
    assert.equal(audio.events.length, before);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('profiler reports tap and wing audio hot-path timing', () => {
  const profiler = new PerfProfiler(100);
  profiler.start(0);
  profiler.tap(0.12);
  profiler.tap(0.30);
  profiler.audio(0.08);
  profiler.audio(0.20);

  for (let index = 0; index <= 6; index++) {
    profiler.frame(index * 16.6667, 1, 0.4);
  }

  assert.equal(profiler.result.tapCount, 2);
  assert.equal(profiler.result.tapMax, 0.30);
  assert.equal(profiler.result.audioCount, 2);
  assert.equal(profiler.result.audioMax, 0.20);
  assert.match(profiler.format(), /tap 2/);
  assert.match(profiler.format(), /audio wing 2/);
});

test('touch pointerdown avoids synchronous WebKit-heavy operations', () => {
  const source = fs.readFileSync(new URL('../site/src/main.js', import.meta.url), 'utf8');
  const match = source.match(/canvas\.addEventListener\('pointerdown',[\s\S]*?\n\}\);/);
  assert.ok(match, 'pointerdown handler not found');
  const handler = match[0];

  assert.doesNotMatch(handler, /tryLockPortrait\(\)/);
  assert.match(handler, /event\.pointerType !== 'touch'/);
  assert.match(handler, /canvas\.focus/);
  assert.match(handler, /setPointerCapture/);

  const position = source.match(/function pointerPosition\(event\)[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(position, /getBoundingClientRect/);
  assert.doesNotMatch(source, /\.\.\.structuredClone\(input\)/);
});
