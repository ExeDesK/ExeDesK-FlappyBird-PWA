export const THEME_VARIANTS = Object.freeze(['day', 'night']);
export const LAND_SCROLL_MODES = Object.freeze(['original', 'defilement']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Configuration de thème invalide : ${label}`);
  }
  return value;
}

function normalizedRandom(random) {
  const raw = Number(random());
  return Number.isFinite(raw)
    ? Math.min(Math.max(raw, 0), 1 - Number.EPSILON)
    : 0;
}

function themeWeight(theme) {
  return theme.weight === undefined ? 1 : Number(theme.weight);
}

function baseThemeEntry(catalog) {
  const entries = Object.entries(catalog.themes);
  const bases = entries.filter(([, theme]) => theme.base === true);
  if (bases.length !== 1) {
    throw new Error('Configuration de thème invalide : un unique thème base est requis');
  }
  return bases[0];
}

function poolEntries(catalog) {
  return Object.entries(catalog.selection?.pools ?? {});
}

function themesInPool(catalog, poolId) {
  return Object.entries(catalog.themes)
    .filter(([, theme]) => theme.pool === poolId && themeWeight(theme) > 0);
}

export function validateThemeCatalog(catalog) {
  if (!isObject(catalog) || catalog.schemaVersion !== 2 || !isObject(catalog.themes)) {
    throw new Error('Configuration assets/themes.json invalide');
  }

  const entries = Object.entries(catalog.themes);
  if (entries.length === 0) {
    throw new Error('Configuration de thème invalide : aucun thème');
  }

  if (!isObject(catalog.selection) || !isObject(catalog.selection.pools)) {
    throw new Error('Configuration de thème invalide : selection.pools');
  }

  const pools = poolEntries(catalog);
  let totalPoolChance = 0;
  for (const [poolId, pool] of pools) {
    if (!poolId || !isObject(pool)) {
      throw new Error('Configuration de thème invalide : selection.pools');
    }

    const chance = Number(pool.chance);
    if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
      throw new Error(`Configuration de thème invalide : selection.pools.${poolId}.chance`);
    }

    totalPoolChance += chance;
  }

  if (totalPoolChance > 1 + Number.EPSILON) {
    throw new Error('Configuration de thème invalide : somme des chances de pools supérieure à 1');
  }

  let baseCount = 0;
  const knownPools = new Set(pools.map(([id]) => id));

  for (const [id, theme] of entries) {
    if (!isObject(theme)) {
      throw new Error(`Configuration de thème invalide : ${id}`);
    }

    requiredString(theme.label, `${id}.label`);
    requiredString(theme.backgroundDay, `${id}.backgroundDay`);
    requiredString(theme.backgroundNight, `${id}.backgroundNight`);
    requiredString(theme.pipeUp, `${id}.pipeUp`);
    requiredString(theme.pipeDown, `${id}.pipeDown`);
    requiredString(theme.bird0, `${id}.bird0`);
    requiredString(theme.bird1, `${id}.bird1`);
    requiredString(theme.bird2, `${id}.bird2`);

    if (!isObject(theme.land)) {
      throw new Error(`Configuration de thème invalide : ${id}.land`);
    }

    requiredString(theme.land.sprite, `${id}.land.sprite`);
    if (!LAND_SCROLL_MODES.includes(theme.land.scrollMode)) {
      throw new Error(`Configuration de thème invalide : ${id}.land.scrollMode`);
    }

    if (!isObject(theme.fill)) {
      throw new Error(`Configuration de thème invalide : ${id}.fill`);
    }

    requiredString(theme.fill.skyDay, `${id}.fill.skyDay`);
    requiredString(theme.fill.skyNight, `${id}.fill.skyNight`);
    requiredString(theme.fill.land, `${id}.fill.land`);

    if (theme.base !== undefined && typeof theme.base !== 'boolean') {
      throw new Error(`Configuration de thème invalide : ${id}.base`);
    }

    if (theme.base === true) {
      baseCount += 1;
      if (theme.pool !== undefined || theme.weight !== undefined) {
        throw new Error(`Configuration de thème invalide : ${id} base ne doit appartenir à aucun pool`);
      }
      continue;
    }

    if (theme.pool !== undefined) {
      requiredString(theme.pool, `${id}.pool`);
      if (!knownPools.has(theme.pool)) {
        throw new Error(`Configuration de thème invalide : ${id}.pool inconnu`);
      }

      const weight = themeWeight(theme);
      if (!Number.isFinite(weight) || weight < 0) {
        throw new Error(`Configuration de thème invalide : ${id}.weight`);
      }
    } else if (theme.weight !== undefined) {
      throw new Error(`Configuration de thème invalide : ${id}.weight sans pool`);
    }
  }

  if (baseCount !== 1) {
    throw new Error('Configuration de thème invalide : un unique thème base est requis');
  }

  for (const [poolId, pool] of pools) {
    if (Number(pool.chance) > 0 && themesInPool(catalog, poolId).length === 0) {
      throw new Error(`Configuration de thème invalide : pool ${poolId} sans thème sélectionnable`);
    }
  }

  return catalog;
}

export function themeEntries(catalog) {
  return Object.entries(validateThemeCatalog(catalog).themes);
}

export function baseThemeId(catalog) {
  const validated = validateThemeCatalog(catalog);
  return baseThemeEntry(validated)[0];
}

export function normalizeThemeMode(value, catalog) {
  if (value === 'auto') {
    return 'auto';
  }

  const themes = validateThemeCatalog(catalog).themes;
  return themes[value] ? value : 'auto';
}

export function normalizeThemeVariant(value) {
  return THEME_VARIANTS.includes(value) ? value : 'day';
}

function chooseThemeFromPool(poolId, random, catalog) {
  const candidates = themesInPool(catalog, poolId);
  const totalWeight = candidates.reduce((sum, [, theme]) => sum + themeWeight(theme), 0);
  let cursor = normalizedRandom(random) * totalWeight;

  for (const [themeId, theme] of candidates) {
    cursor -= themeWeight(theme);
    if (cursor < 0) {
      return themeId;
    }
  }

  return candidates.at(-1)?.[0] ?? baseThemeEntry(catalog)[0];
}

export function chooseAutoTheme(random = Math.random, catalog) {
  const validated = validateThemeCatalog(catalog);
  let cursor = normalizedRandom(random);

  for (const [poolId, pool] of poolEntries(validated)) {
    const chance = Number(pool.chance);
    if (cursor < chance) {
      return chooseThemeFromPool(poolId, random, validated);
    }
    cursor -= chance;
  }

  return baseThemeEntry(validated)[0];
}

export function resolveRunTheme({
  mode = 'auto',
  variant = 'day',
  random = Math.random,
  catalog,
} = {}) {
  const normalizedMode = normalizeThemeMode(mode, catalog);

  if (normalizedMode === 'auto') {
    return {
      mode: normalizedMode,
      theme: chooseAutoTheme(random, catalog),
      variant: 'auto',
    };
  }

  return {
    mode: normalizedMode,
    theme: normalizedMode,
    variant: normalizeThemeVariant(variant),
  };
}

export function effectiveDayNight(backgroundName = 'bg_day', variant = 'auto') {
  if (variant === 'day' || variant === 'night') {
    return variant;
  }

  return backgroundName.endsWith('_night') ? 'night' : 'day';
}

export function themeDefinition(activeTheme = {}, catalog) {
  const themes = catalog?.themes;
  if (!isObject(themes)) {
    throw new Error('Catalogue de thèmes non chargé');
  }

  const fallback = Object.entries(themes).find(([, theme]) => theme?.base === true);
  if (!fallback) {
    throw new Error('Catalogue de thèmes sans thème base');
  }

  return themes[activeTheme.theme] ?? fallback[1];
}

function themedBirdName(name, definition) {
  const match = /^bird(\d+)_([012])$/.exec(name);
  if (!match) {
    return null;
  }

  const [, color, frame] = match;
  const template = definition[`bird${frame}`];
  return template.replaceAll('{color}', color);
}

export function themedSpriteName(name, activeTheme = {}, catalog) {
  const definition = themeDefinition(activeTheme, catalog);
  const variant = activeTheme.variant ?? 'auto';

  if (name === 'bg_day' || name === 'bg_night') {
    const dayNight = effectiveDayNight(name, variant);
    return dayNight === 'night' ? definition.backgroundNight : definition.backgroundDay;
  }

  if (name === 'land') {
    return definition.land.sprite;
  }

  if (name === 'pipe_up') {
    return definition.pipeUp;
  }

  if (name === 'pipe_down') {
    return definition.pipeDown;
  }

  return themedBirdName(name, definition) ?? name;
}

export function themeLandScrollMode(activeTheme = {}, catalog) {
  return themeDefinition(activeTheme, catalog).land.scrollMode;
}
