import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { Audio } from '../site/src/audio.js';
import { PerfProfiler } from '../site/src/perf.js';
import {
  isIOSWebKitEnvironment,
  normalizeFrameDriverPreference,
  resolveFrameDriver,
} from '../site/src/frame-driver.js';

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
  profiler.start(0, 'raf');
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
  assert.match(handler, /const isTouch = event\.pointerType === 'touch'/);
  assert.match(handler, /if \(!isTouch\)/);
  assert.match(handler, /event\.preventDefault\(\)/);
  assert.doesNotMatch(handler, /canvas\.focus/);
  assert.match(handler, /setPointerCapture/);

  const position = source.match(/function pointerPosition\(event\)[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(position, /getBoundingClientRect/);
  assert.doesNotMatch(source, /\.\.\.structuredClone\(input\)/);
});


test('profiler correlates a tap with the next delayed animation frame', () => {
  const profiler = new PerfProfiler(1000);
  profiler.start(0, 'raf');
  profiler.frame(0, 1, 0.2);
  profiler.markTap(4);
  profiler.frame(30, 2, 0.2);
  const result = profiler.finish(30);

  assert.equal(result.tapRafCount, 1);
  assert.equal(result.tapToRafMax, 26);
  assert.equal(result.tapFrameDeltaMax, 30);
  assert.equal(result.tapFramesOver25, 1);
  assert.match(profiler.format(), /tap→frame 1/);
  assert.match(profiler.format(), /frame avec tap/);
});

test('game canvas is not focusable and relies on touch-action for touch gestures', () => {
  const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../site/style.css', import.meta.url), 'utf8');
  const canvas = html.match(/<canvas[\s\S]*?<\/canvas>/)?.[0] ?? '';

  assert.doesNotMatch(canvas, /tabindex=/);
  assert.match(css, /#game[\s\S]*?touch-action:\s*none/);
  assert.match(css, /#game[\s\S]*?-webkit-touch-callout:\s*none/);
});


test('auto frame driver uses worker ticker on iOS WebKit and rAF elsewhere', () => {
  const ios = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
    workerAvailable: true,
  };
  const desktop = {
    userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
    platform: 'Win32',
    maxTouchPoints: 0,
    workerAvailable: true,
  };

  assert.equal(isIOSWebKitEnvironment(ios), true);
  assert.equal(resolveFrameDriver('auto', ios), 'worker');
  assert.equal(resolveFrameDriver('auto', desktop), 'raf');
  assert.equal(resolveFrameDriver('raf', ios), 'raf');
  assert.equal(resolveFrameDriver('worker', ios), 'worker');
  assert.equal(resolveFrameDriver('timer', desktop), 'timer');
  assert.equal(resolveFrameDriver('auto', { ...ios, workerAvailable: false }), 'raf');
  assert.equal(normalizeFrameDriverPreference('wat'), 'auto');
});

test('main loop offers worker and timer drivers without changing the fixed simulation clock', () => {
  const source = fs.readFileSync(new URL('../site/src/main.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');

  assert.match(source, /resolveFrameDriver/);
  assert.match(source, /new Worker\(/);
  assert.match(source, /frame-ticker\.worker\.js/);
  assert.match(source, /setInterval\(\(\) =>/);
  assert.match(source, /FRAME_DRIVER_PERIOD_MS/);
  assert.match(source, /new FixedClock\(60\)/);
  assert.match(html, /id="frame-driver"/);
  assert.match(html, /AUTO \(WORKER SUR iOS\)/);
  assert.match(html, /WORKER 60 Hz/);
});


test('worker ticker uses drift-corrected scheduling and never owns game physics', () => {
  const worker = fs.readFileSync(new URL('../site/src/frame-ticker.worker.js', import.meta.url), 'utf8');

  assert.match(worker, /periodMs = 1000 \/ 60/);
  assert.match(worker, /nextAt \+= periodMs/);
  assert.match(worker, /setTimeout\(tick, delay\)/);
  assert.match(worker, /postMessage\(\{ type: 'frame' \}\)/);
  assert.doesNotMatch(worker, /import\s|new\s+Game|new\s+FixedClock|physics_version/);
});
