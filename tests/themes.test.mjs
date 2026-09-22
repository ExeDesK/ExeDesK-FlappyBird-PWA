import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AUTO_FRANCE_DENOMINATOR,
  chooseAutoTheme,
  resolveRunTheme,
  themedSpriteName,
} from '../site/src/themes.js';

const manifest = JSON.parse(
  readFileSync(new URL('../site/assets/customatlas.json', import.meta.url)),
);

test('Auto theme uses a 1/30 France threshold', () => {
  assert.equal(AUTO_FRANCE_DENOMINATOR, 30);
  assert.equal(chooseAutoTheme(() => 0), 'france');
  assert.equal(chooseAutoTheme(() => (1 / 30) - Number.EPSILON), 'france');
  assert.equal(chooseAutoTheme(() => 1 / 30), 'original');
  assert.equal(chooseAutoTheme(() => 0.999), 'original');
});

test('Forced theme keeps an explicit day/night variant', () => {
  assert.deepEqual(resolveRunTheme({ mode: 'france', variant: 'night' }), {
    mode: 'france',
    theme: 'france',
    variant: 'night',
  });
  assert.deepEqual(resolveRunTheme({ mode: 'original', variant: 'day' }), {
    mode: 'original',
    theme: 'original',
    variant: 'day',
  });
});

test('France theme remaps visuals only', () => {
  const theme = { theme: 'france', variant: 'night' };
  assert.equal(themedSpriteName('bg_day', theme), 'bg_france_night');
  assert.equal(themedSpriteName('pipe_up', theme), 'pipe_france_up');
  assert.equal(themedSpriteName('pipe_down', theme), 'pipe_france_down');
  assert.equal(themedSpriteName('land', theme), 'land_france');
  assert.equal(themedSpriteName('bird2_0', theme), 'bird_france_0');
  assert.equal(themedSpriteName('bird0_2', theme), 'bird_france_2');
  assert.equal(themedSpriteName('score_panel', theme), 'score_panel');
});

test('Custom atlas manifest contains every runtime France/button sprite', () => {
  const required = [
    'bg_france_day',
    'bg_france_night',
    'pipe_france_down',
    'pipe_france_up',
    'land_france',
    'bird_france_0',
    'bird_france_1',
    'bird_france_2',
    'button_home',
    'button_options',
  ];

  for (const name of required) {
    assert.ok(manifest.frames[name], `missing ${name}`);
  }

  assert.equal(manifest.meta.image, 'customatlas.png');
  assert.deepEqual(manifest.meta.size, { w: 918, h: 514 });
});
