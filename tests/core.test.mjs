import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { cyclicLerp, previousFor } from '../site/src/atlas.js';
import { FixedClock } from '../site/src/clock.js';
import {
  compositeLandColor,
  computeDisplaySize,
  defaultAspectForCapabilities,
  renderQualityScale,
  skyColorForBackground,
} from '../site/src/display.js';
import { Bird, Game } from '../site/src/game.js';
import {
  Animation,
  F,
  Random,
  SIN,
  Tween,
  overlaps,
} from '../site/src/math.js';
import { PerfProfiler } from '../site/src/perf.js';
import { runReplay } from './replay.mjs';

const reference = JSON.parse(
  readFileSync(new URL('./java-reference.json', import.meta.url)),
);

const bits = number => new Int32Array(new Float32Array([number]).buffer)[0];

for (const { seed, values } of reference.random) {
  test(`Java PRNG: seed ${seed}, 500 outputs`, () => {
    const random = new Random(seed);
    const actual = Array.from({ length: 500 }, () => random.next());
    assert.deepEqual(actual, values);
  });
}

test('Bird arithmetic agrees bit-for-bit with JVM reference across 2000 updates', () => {
  const bird = new Bird(new Random(1), () => {});
  bird.idle = false;

  for (const row of reference.bird) {
    const frame = row[0];

    if (frame === 1 || frame % 19 === 0 || frame % 71 === 0) {
      bird.flap();
    }

    bird.tick();

    assert.deepEqual(
      [
        frame,
        bird.y,
        bits(bird.velocity),
        bits(bird.gravity),
        bits(bird.rotation),
        bits(bird.rotationSpeed),
      ],
      row,
      `frame ${frame}`,
    );
  }
});

test('360-entry sine table agrees with JVM reference', () => {
  assert.deepEqual([...SIN].map(bits), reference.sin);
});

test('Idle bob uses 8 degrees/update and wraps after 45', () => {
  const bird = new Bird(new Random(1), () => {});

  for (let index = 0; index < 45; index++) {
    bird.tick();
  }

  assert.equal(bird.phase, 0);
  assert.equal(bird.y, 246);
  assert.equal(bird.bob, 0);
});

test('Hitbox is inclusive on touching edges', () => {
  assert.equal(overlaps(80, 246, 20, 20, 100, 240, 52, 320), true);
  assert.equal(overlaps(80, 246, 20, 20, 101, 240, 52, 320), false);
});

test('Flaps above the top are ignored', () => {
  const bird = new Bird(new Random(1), () => {});
  bird.y = -1;
  bird.velocity = 3;

  assert.equal(bird.flap(), false);
  assert.equal(bird.velocity, 3);
});

test('Ground clamps to y=380 and kills vertical speed', () => {
  const bird = new Bird(new Random(1), () => {});
  bird.idle = false;

  for (let index = 0; index < 100; index++) {
    bird.tick();
  }

  assert.equal(bird.y, 380);
  assert.equal(bird.velocity, 0);
  assert.equal(bird.gravity, 0);
});

test('Animation clock uses integer thresholds 33 and 100, with +15', () => {
  const fast = new Animation([0, 1, 2], 30, false);
  fast.tick();
  fast.tick();
  assert.equal(fast.frame, 0);
  fast.tick();
  assert.equal(fast.frame, 1);

  const slow = new Animation([0, 1, 2], 10, true);

  for (let index = 0; index < 6; index++) {
    slow.tick();
  }

  assert.equal(slow.frame, 0);
  slow.tick();
  assert.equal(slow.frame, 1);
});

test('Tween IDs 5 and 11 are cubic-out and quintic-out, 30 frames per half second', () => {
  for (const [id, midpoint] of [[5, 0.875], [11, 0.96875]]) {
    const tween = new Tween();
    tween.start(0, 1, id, 0.5);

    for (let index = 0; index < 15; index++) {
      tween.tick();
    }

    assert.equal(tween.value, midpoint);

    for (let index = 0; index < 15; index++) {
      tween.tick();
    }

    assert.equal(tween.value, 1);
    assert.equal(tween.done, true);
  }
});

test('1000-delay events fire after 34 updates; 500-delay after 17', () => {
  const game = new Game({ seed: 1 });
  game.tick();

  const hits = [];
  game.event = id => {
    if (id >= 90) {
      hits.push({ id, frame: game.frame });
    }
  };

  game.queue(99, 1000);
  game.queue(98, 500);

  for (let index = 0; index < 34; index++) {
    game.tick();
  }

  assert.deepEqual(hits, [
    { id: 98, frame: 18 },
    { id: 99, frame: 35 },
  ]);
});

test('Score increments at pipe x=bird x, not when its trailing edge passes', () => {
  const game = new Game({ seed: 1 });
  game.tick();
  game.hidden = 0;
  game.speed = 2;
  game.pipes[0].x = 82;
  game.bird.x = 80;
  game.score = 0;

  game.movePipes();
  assert.equal(game.score, 1);

  game.movePipes();
  assert.equal(game.score, 1);
});

test('Pipe positions survive reset; spacing is 157 after recycling', () => {
  const game = new Game({ seed: 1 });
  game.tick();
  game.pipes = [
    { x: -53, y: 210 },
    { x: 104, y: 250 },
    { x: 261, y: 300 },
  ];

  game.menuReset();
  assert.equal(game.pipes[0].x, -53);

  game.hidden = 0;
  game.movePipes();

  assert.equal(game.pipes[2].x - game.pipes[1].x, 157);
  assert.ok(game.pipes[2].y >= 180 && game.pipes[2].y < 360);
});

test('Menu -> play release -> ready -> flying -> death -> panel -> replay', () => {
  const game = new Game({ seed: 12345 });

  for (let index = 0; index < 40; index++) {
    game.tick();
  }

  assert.equal(game.state, 'MENU');

  game.tick({ touches: [{ x: 78, y: 375 }] });
  game.tick({ touches: [] });

  for (let index = 0; index < 65; index++) {
    game.tick();
  }

  assert.equal(game.state, 'READY');

  game.tick({ tap: { x: 144, y: 256 } });
  assert.equal(game.state, 'PLAYING');

  for (let index = 0; index < 220; index++) {
    game.tick();
  }

  assert.equal(game.state, 'GAME_OVER');
  assert.equal(game.panel.stage, 2);
  assert.equal(game.play.active, true);

  game.tick({ touches: [{ x: 78, y: 375 }] });
  game.tick();

  for (let index = 0; index < 65; index++) {
    game.tick();
  }

  assert.equal(game.state, 'READY');
  assert.equal(game.score, 0);
});

test('Two runs with the same input stream and seed are deterministic', () => {
  const first = new Game({ seed: -9876543 });
  const second = new Game({ seed: -9876543 });

  for (let index = 0; index < 2000; index++) {
    const input = {};

    if (index === 45) {
      input.touches = [{ x: 78, y: 375 }];
    }

    if (index > 110 && index % 21 === 0) {
      input.tap = { x: 144, y: 256 };
    }

    first.tick(input);
    second.tick(input);
    assert.deepEqual(first.snapshot(), second.snapshot());
  }
});

test('All display-list sprite names resolve in supplied atlas', () => {
  const atlas = readFileSync(
    new URL('../site/assets/atlas.txt', import.meta.url),
    'utf8',
  );
  const names = new Set(
    atlas
      .trim()
      .split(/\r?\n/)
      .map(line => line.split(' ')[0]),
  );

  const game = new Game({ seed: 10 });

  for (let index = 0; index < 400; index++) {
    const input =
      index === 40
        ? { touches: [{ x: 78, y: 375 }] }
        : index === 120
          ? { tap: { x: 144, y: 256 } }
          : {};

    game.tick(input);

    for (const command of game.commands) {
      assert.ok(names.has(command.name), command.name);
    }
  }
});

for (const hz of [30, 60, 90, 120, 144, 240]) {
  test(`60 simulation updates/sec at ${hz} Hz presentation`, () => {
    const clock = new FixedClock(60);
    let ticks = 0;

    for (let index = 0; index <= hz * 10; index++) {
      ticks += clock.steps(index * 1000 / hz);
    }

    assert.equal(ticks, 600);
  });
}

test('Slow displays catch up to 60 Hz while large background gaps stay bounded', () => {
  const clock = new FixedClock(60, 5);
  let ticks = 0;

  for (let index = 0; index <= 300; index++) {
    ticks += clock.steps(index * 1000 / 30);
  }

  assert.equal(ticks, 600);
  assert.equal(clock.steps(100000), 5);
  assert.ok(clock.steps(100001) <= 1);

  clock.reset();
  assert.equal(clock.steps(100002), 0);
});

test('Score panel medals and record thresholds match all four native tiers', () => {
  const cases = [
    [0, -1],
    [9, -1],
    [10, 3],
    [19, 3],
    [20, 2],
    [29, 2],
    [30, 1],
    [39, 1],
    [40, 0],
    [99, 0],
  ];

  for (const [score, medal] of cases) {
    const game = new Game({ seed: 1, best: 5 });
    game.panel.start(score, 5);

    for (let index = 0; index < 65; index++) {
      game.panel.tick(game);
    }

    assert.equal(game.panel.stage, 2);
    assert.equal(game.panel.score, score);
    assert.equal(game.panel.medal, medal);
    assert.equal(game.best, Math.max(score, 5));
    assert.equal(game.panel.newRecord, score > 5);
  }
});

test('Sparse replay survives JSON export and reproduces the exact final snapshot', () => {
  const seed = -1234567;
  const bestAtBoot = 12;
  const game = new Game({ seed, best: bestAtBoot });
  const inputs = [];
  let previous = '';

  for (let frame = 1; frame <= 600; frame++) {
    const input = { touches: [] };

    if (frame === 45) {
      input.touches = [{ x: 78, y: 375 }];
    }

    if (frame > 110 && frame % 22 === 0) {
      input.tap = { x: 144, y: 256 };
    }

    const signature = JSON.stringify(input);

    if (signature !== previous || input.tap) {
      inputs.push({ frame, ...input });
    }

    previous = signature;
    game.tick(input);
  }

  const data = {
    schema: 'flappy13-replay-v1',
    seed,
    bestAtBoot,
    totalFrames: game.frame,
    truncated: false,
    inputs,
    final: game.snapshot(),
  };

  const serialized = JSON.parse(JSON.stringify(data));
  assert.deepEqual(runReplay(serialized), game.snapshot());
});

test('Performance profiler reports cadence and drop buckets', () => {
  const profiler = new PerfProfiler(100);
  profiler.start(0);

  for (let index = 0; index <= 6; index++) {
    profiler.frame(index * 16.6667, 1, 0.4);
  }

  const result = profiler.result;

  assert.ok(result);
  assert.ok(result.rafFps > 50 && result.rafFps < 70);
  assert.equal(result.over33, 0);
  assert.equal(result.steps1, 7);
  assert.equal(result.maxSteps, 1);
});

test('Land interpolation crosses the 24 px wrap forward without visual rollback', () => {
  assert.equal(cyclicLerp(-22, 0, 0, 24), -22);
  assert.equal(cyclicLerp(-22, 0, 0.5, 24), -23);
  assert.equal(cyclicLerp(-22, 0, 1, 24), 0);
});

test('Render identities follow a pipe across slot recycling', () => {
  const previous = [
    { name: 'pipe_up', key: 'pipe-7-up', x: 104 },
    { name: 'pipe_up', key: 'pipe-8-up', x: 261 },
  ];
  const current = [
    { name: 'pipe_up', key: 'pipe-8-up', x: 259 },
    { name: 'pipe_up', key: 'pipe-9-up', x: 416 },
  ];

  assert.equal(previousFor(current[0], 0, previous), previous[1]);
  assert.equal(previousFor(current[1], 1, previous), null);
});

test('All visible pipe commands carry stable render identities', () => {
  const game = new Game({ seed: 123 });
  game.tick();
  game.menu = false;
  game.hidden = 0;
  game.speed = 2;
  game.bird.idle = false;
  game.tick();

  const pipes = game.commands.filter(command =>
    command.name === 'pipe_up' || command.name === 'pipe_down',
  );

  assert.equal(pipes.length, 6);
  assert.ok(
    pipes.every(command =>
      typeof command.key === 'string' && command.key.startsWith('pipe-'),
    ),
  );
});

test('Adapted aspect centers the 288:512 game and fills the full portrait height', () => {
  const size = computeDisplaySize(440, 796, { aspect: 'adapted' });

  assert.ok(Math.abs(size.gameWidth - 440) < 1e-9);
  assert.ok(Math.abs(size.gameWidth / size.gameHeight - 288 / 512) < 1e-12);
  assert.ok(size.topGap > 0 && size.bottomGap > 0);
  assert.ok(Math.abs(size.topGap - size.bottomGap) < 1e-9);
  assert.ok(Math.abs(size.height - 796) < 1e-9);
  assert.ok(
    Math.abs((size.topPad + 512 + size.bottomPad) * size.scaleY - 796) < 1e-8,
  );
});

test('Adapted aspect never stretches the logical game non-uniformly', () => {
  for (const [width, height] of [[440, 796], [390, 844], [1200, 2200], [440, 700]]) {
    const size = computeDisplaySize(width, height, { aspect: 'adapted' });

    assert.equal(size.scaleX, size.scaleY);
    assert.ok(size.gameWidth <= width + 1e-9);
    assert.ok(size.gameHeight <= height + 1e-9);
    assert.ok(size.width <= width + 1e-9);
    assert.ok(size.height <= height + 1e-9);
  }
});

test('Original aspect preserves 288:512 with no scene padding', () => {
  const size = computeDisplaySize(440, 796, { aspect: 'original' });

  assert.ok(size.width <= 440 && size.height <= 796);
  assert.ok(Math.abs(size.width / size.height - 288 / 512) < 1e-12);
  assert.equal(size.topPad, 0);
  assert.equal(size.bottomPad, 0);
});

test('Performance mode affects backing supersampling, not CSS game size', () => {
  const normal = computeDisplaySize(1200, 2200, { aspect: 'adapted' });
  const performance = computeDisplaySize(1200, 2200, {
    aspect: 'adapted',
    performance: true,
  });

  assert.deepEqual(performance, normal);
  assert.equal(renderQualityScale(3, { performance: true }), 2);
});

test('Aspect default is Original on desktop and Adapted on touch/mobile-class input', () => {
  assert.equal(defaultAspectForCapabilities({ desktop: true }), 'original');
  assert.equal(defaultAspectForCapabilities({ desktop: false }), 'adapted');
});

test('Scene extension colors match original day/night sky and land', () => {
  assert.equal(skyColorForBackground('bg_day'), 'rgb(78, 192, 202)');
  assert.equal(skyColorForBackground('bg_night'), 'rgb(0, 135, 147)');
  assert.equal(compositeLandColor(0, 0), 'rgb(222, 216, 149)');
  assert.equal(compositeLandColor(1, 0), 'rgb(0, 0, 0)');
  assert.equal(compositeLandColor(0, 1), 'rgb(255, 255, 255)');
  assert.equal(compositeLandColor(0.5, 0), 'rgb(111, 108, 75)');
});

test('Renderer supersamples rotated sprites at x2 desktop and x3 high-DPR mobile', () => {
  assert.equal(renderQualityScale(1, { performance: false }), 2);
  assert.equal(renderQualityScale(2, { performance: false }), 2);
  assert.equal(renderQualityScale(3, { performance: false }), 3);
  assert.equal(renderQualityScale(4, { performance: false }), 3);
  assert.equal(renderQualityScale(3, { performance: true }), 2);
});

test('PWA requests portrait-primary and avoids translucent iOS status-bar blur', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../site/manifest.webmanifest', import.meta.url), 'utf8'),
  );
  const html = readFileSync(
    new URL('../site/index.html', import.meta.url),
    'utf8',
  );

  assert.equal(manifest.orientation, 'portrait-primary');
  assert.match(html, /apple-mobile-web-app-status-bar-style" content="black"/);
  assert.doesNotMatch(html, /black-translucent/);
});

test('Adapted scene extension is rendered by Canvas, not a CSS pseudo-element', () => {
  const css = readFileSync(
    new URL('../site/style.css', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(css, /#stage\[data-aspect="adapted"\]::after/);
  assert.match(css, /#stage\[data-aspect="adapted"\][\s\S]*align-items:\s*center/);
});

test('GitHub Pages paths stay relative to the repository base path', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../site/manifest.webmanifest', import.meta.url), 'utf8'),
  );
  const html = readFileSync(
    new URL('../site/index.html', import.meta.url),
    'utf8',
  );

  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.match(html, /href="\.\/manifest\.webmanifest"/);
  assert.match(html, /src="\.\/src\/main\.js"/);
});

test('Static update probe uses version.json instead of a dynamic health endpoint', () => {
  const main = readFileSync(
    new URL('../site/src/main.js', import.meta.url),
    'utf8',
  );
  const version = JSON.parse(
    readFileSync(new URL('../site/version.json', import.meta.url), 'utf8'),
  );

  assert.equal(version.version, '0.2.7.2b-dev3');
  assert.match(main, /\.\/version\.json/);
  assert.doesNotMatch(main, /__health/);
});


test('Score sync success takes precedence over stale profile/auth errors in account status', () => {
  const main = readFileSync(new URL('../site/src/main.js', import.meta.url), 'utf8');
  const syncedIndex = main.indexOf("scoreSyncState === 'synced'");
  const scoreErrorIndex = main.indexOf("scoreSyncState === 'error'", syncedIndex);
  const staleAuthErrorIndex = main.indexOf('state.error', scoreErrorIndex);
  assert.ok(syncedIndex >= 0);
  assert.ok(scoreErrorIndex > syncedIndex, 'score sync error must be checked after successful sync');
  assert.ok(staleAuthErrorIndex > scoreErrorIndex, 'stale auth/profile error must not override a synced score');
});
