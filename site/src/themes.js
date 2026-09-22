export const AUTO_FRANCE_DENOMINATOR = 30;

export const THEME_MODES = Object.freeze(['auto', 'original', 'france']);
export const THEME_VARIANTS = Object.freeze(['day', 'night']);

export function normalizeThemeMode(value) {
  return THEME_MODES.includes(value) ? value : 'auto';
}

export function normalizeThemeVariant(value) {
  return THEME_VARIANTS.includes(value) ? value : 'day';
}

export function chooseAutoTheme(random = Math.random) {
  const sample = Number(random());
  return Number.isFinite(sample) && sample >= 0 && sample < (1 / AUTO_FRANCE_DENOMINATOR)
    ? 'france'
    : 'original';
}

export function resolveRunTheme({ mode = 'auto', variant = 'day', random = Math.random } = {}) {
  const normalizedMode = normalizeThemeMode(mode);

  if (normalizedMode === 'auto') {
    return {
      mode: normalizedMode,
      theme: chooseAutoTheme(random),
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

export function themedSpriteName(name, activeTheme = {}) {
  const theme = activeTheme.theme === 'france' ? 'france' : 'original';
  const variant = activeTheme.variant ?? 'auto';

  if (name === 'bg_day' || name === 'bg_night') {
    const dayNight = effectiveDayNight(name, variant);
    return theme === 'france' ? `bg_france_${dayNight}` : `bg_${dayNight}`;
  }

  if (theme !== 'france') {
    return name;
  }

  if (name === 'land') {
    return 'land_france';
  }

  if (name === 'pipe_up') {
    return 'pipe_france_up';
  }

  if (name === 'pipe_down') {
    return 'pipe_france_down';
  }

  const bird = /^bird\d_([012])$/.exec(name);
  if (bird) {
    return `bird_france_${bird[1]}`;
  }

  return name;
}
