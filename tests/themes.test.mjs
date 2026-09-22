import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  baseThemeId,
  chooseAutoTheme,
  resolveRunTheme,
  themeEntries,
  themeLandScrollMode,
  themedSpriteName,
  validateThemeCatalog,
} from '../site/src/themes.js';

const manifest = JSON.parse(
  readFileSync(new URL('../site/assets/customatlas.json', import.meta.url)),
);
const catalog = JSON.parse(
  readFileSync(new URL('../site/assets/themes.json', import.meta.url)),
);

function sequenceRandom(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

validateThemeCatalog(catalog);

test('Theme catalog defines a base theme and a 1/30 country pool', () => {
  assert.equal(catalog.schemaVersion, 2);
  assert.deepEqual(themeEntries(catalog).map(([id]) => id), ['original', 'france', 'vietnam']);
  assert.equal(baseThemeId(catalog), 'original');
  assert.equal(catalog.themes.original.base, true);
  assert.deepEqual(catalog.selection.pools, {
    country: { chance: 0.03333333333333333 },
  });
  assert.equal(catalog.themes.france.pool, 'country');
  assert.equal(catalog.themes.france.weight, 1);
  assert.equal(catalog.themes.vietnam.pool, 'country');
  assert.equal(catalog.themes.vietnam.weight, 1);
});

test('Auto keeps the country pool at exactly 1/30 independently of its theme count', () => {
  assert.equal(chooseAutoTheme(sequenceRandom([0, 0]), catalog), 'france');
  assert.equal(
    chooseAutoTheme(sequenceRandom([(1 / 30) - Number.EPSILON, 0.999]), catalog),
    'vietnam',
  );
  assert.equal(chooseAutoTheme(() => 1 / 30, catalog), 'original');
  assert.equal(chooseAutoTheme(() => 0.999, catalog), 'original');

  const manyCountries = structuredClone(catalog);
  for (let index = 2; index <= 10; index += 1) {
    manyCountries.themes[`country${index}`] = {
      ...structuredClone(manyCountries.themes.france),
      label: `Country ${index}`,
      weight: 1,
    };
  }
  validateThemeCatalog(manyCountries);

  assert.equal(
    chooseAutoTheme(sequenceRandom([(1 / 30) - Number.EPSILON, 0.999]), manyCountries),
    'country10',
  );
  assert.equal(chooseAutoTheme(() => 1 / 30, manyCountries), 'original');
});

test('Theme weights are relative only inside their pool', () => {
  const weighted = structuredClone(catalog);
  weighted.themes.japan = {
    ...structuredClone(weighted.themes.france),
    label: 'Japan',
    weight: 3,
  };
  validateThemeCatalog(weighted);

  assert.equal(chooseAutoTheme(sequenceRandom([0, 0]), weighted), 'france');
  assert.equal(chooseAutoTheme(sequenceRandom([0, 0.199999]), weighted), 'france');
  assert.equal(chooseAutoTheme(sequenceRandom([0, 0.2]), weighted), 'vietnam');
  assert.equal(chooseAutoTheme(sequenceRandom([0, 0.399999]), weighted), 'vietnam');
  assert.equal(chooseAutoTheme(sequenceRandom([0, 0.4]), weighted), 'japan');
  assert.equal(chooseAutoTheme(sequenceRandom([0, 0.999]), weighted), 'japan');

  weighted.themes.france.weight = 0;
  validateThemeCatalog(weighted);
  assert.equal(chooseAutoTheme(sequenceRandom([0, 0]), weighted), 'vietnam');
  assert.ok(themeEntries(weighted).some(([id]) => id === 'france'));
});

test('Forced theme keeps an explicit day/night variant', () => {
  assert.deepEqual(resolveRunTheme({ mode: 'france', variant: 'night', catalog }), {
    mode: 'france',
    theme: 'france',
    variant: 'night',
  });
  assert.deepEqual(resolveRunTheme({ mode: 'original', variant: 'day', catalog }), {
    mode: 'original',
    theme: 'original',
    variant: 'day',
  });
});

test('Theme JSON drives sprite remapping and land scroll mode', () => {
  const france = { theme: 'france', variant: 'night' };
  assert.equal(themedSpriteName('bg_day', france, catalog), 'bg_france_night');
  assert.equal(themedSpriteName('pipe_up', france, catalog), 'pipe_france_up');
  assert.equal(themedSpriteName('pipe_down', france, catalog), 'pipe_france_down');
  assert.equal(themedSpriteName('land', france, catalog), 'land_france');
  assert.equal(themedSpriteName('bird2_0', france, catalog), 'bird_france_0');
  assert.equal(themedSpriteName('bird0_2', france, catalog), 'bird_france_2');
  assert.equal(themedSpriteName('score_panel', france, catalog), 'score_panel');
  assert.equal(themeLandScrollMode(france, catalog), 'defilement');

  const vietnam = { theme: 'vietnam', variant: 'night' };
  assert.equal(themedSpriteName('bg_day', vietnam, catalog), 'bg_vietnam_night');
  assert.equal(themedSpriteName('pipe_up', vietnam, catalog), 'pipe_vietnam_up');
  assert.equal(themedSpriteName('pipe_down', vietnam, catalog), 'pipe_vietnam_down');
  assert.equal(themedSpriteName('land', vietnam, catalog), 'land_vietnam');
  assert.equal(themedSpriteName('bird1_1', vietnam, catalog), 'bird_vietnam_1');
  assert.equal(themeLandScrollMode(vietnam, catalog), 'defilement');

  const original = { theme: 'original', variant: 'day' };
  assert.equal(themedSpriteName('bird2_0', original, catalog), 'bird2_0');
  assert.equal(themedSpriteName('bird0_2', original, catalog), 'bird0_2');
  assert.equal(themeLandScrollMode(original, catalog), 'original');
});

test('Theme catalog rejects invalid pool/base/scroll configurations', () => {
  const invalidScroll = structuredClone(catalog);
  invalidScroll.themes.france.land.scrollMode = 'teleport';
  assert.throws(() => validateThemeCatalog(invalidScroll), /land\.scrollMode/);

  const negativeWeight = structuredClone(catalog);
  negativeWeight.themes.france.weight = -1;
  assert.throws(() => validateThemeCatalog(negativeWeight), /france\.weight/);

  const unknownPool = structuredClone(catalog);
  unknownPool.themes.france.pool = 'missing';
  assert.throws(() => validateThemeCatalog(unknownPool), /france\.pool inconnu/);

  const twoBases = structuredClone(catalog);
  twoBases.themes.france.base = true;
  delete twoBases.themes.france.pool;
  delete twoBases.themes.france.weight;
  assert.throws(() => validateThemeCatalog(twoBases), /unique thème base/);

  const overflow = structuredClone(catalog);
  overflow.selection.pools.special = { chance: 0.98 };
  assert.throws(() => validateThemeCatalog(overflow), /somme des chances/);
});

test('Custom atlas manifest contains every runtime France/Vietnam/button sprite', () => {
  const required = [
    'bg_france_day',
    'bg_france_night',
    'pipe_france_down',
    'pipe_france_up',
    'land_france',
    'bird_france_0',
    'bird_france_1',
    'bird_france_2',
    'bg_vietnam_day',
    'bg_vietnam_night',
    'pipe_vietnam_down',
    'pipe_vietnam_up',
    'land_vietnam',
    'bird_vietnam_0',
    'bird_vietnam_1',
    'bird_vietnam_2',
    'button_home',
    'button_options',
  ];

  for (const name of required) {
    assert.ok(manifest.frames[name], `missing ${name}`);
  }

  assert.equal(manifest.meta.image, 'customatlas.png');
  assert.deepEqual(manifest.meta.size, { w: 1714, h: 514 });
});
