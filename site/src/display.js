export const LOGICAL_WIDTH = 288;
export const LOGICAL_HEIGHT = 512;

export const LAND_FILL = [222, 216, 149];
export const SKY_DAY = [78, 192, 202];
export const SKY_NIGHT = [0, 135, 147];

export function defaultAspectForCapabilities({ desktop = false } = {}) {
  return desktop ? 'original' : 'adapted';
}

export function renderQualityScale(dpr = 1, { performance = false } = {}) {
  const ratio = Math.max(1, Number(dpr) || 1);

  if (performance) {
    return 2;
  }

  return Math.min(3, Math.max(2, Math.ceil(ratio)));
}

export function rgb(values) {
  return `rgb(${values[0]}, ${values[1]}, ${values[2]})`;
}

export function skyColorForBackground(name = 'bg_day') {
  return rgb(name === 'bg_night' ? SKY_NIGHT : SKY_DAY);
}

export function compositeColor(base, fade = 0, flash = 0) {
  const fadeAmount = Math.max(0, Math.min(1, Number(fade) || 0));
  const flashAmount = Math.max(0, Math.min(1, Number(flash) || 0));
  const output = base.map(value =>
    Math.round((value * (1 - fadeAmount)) * (1 - flashAmount) + 255 * flashAmount),
  );

  return rgb(output);
}

export function compositeLandColor(fade = 0, flash = 0) {
  return compositeColor(LAND_FILL, fade, flash);
}

export function compositeSkyColor(background = 'bg_day', fade = 0, flash = 0) {
  const color = background === 'bg_night' ? SKY_NIGHT : SKY_DAY;
  return compositeColor(color, fade, flash);
}

export function computeDisplaySize(stageWidth, stageHeight, { aspect = 'adapted' } = {}) {
  const width = Math.max(0, Number(stageWidth) || 0);
  const height = Math.max(0, Number(stageHeight) || 0);
  const scale = Math.max(
    0,
    Math.min(width / LOGICAL_WIDTH, height / LOGICAL_HEIGHT),
  );

  const gameWidth = LOGICAL_WIDTH * scale;
  const gameHeight = LOGICAL_HEIGHT * scale;

  if (aspect === 'adapted' && scale > 0) {
    const extra = Math.max(0, height - gameHeight);
    const topGap = extra / 2;
    const bottomGap = extra - topGap;

    return {
      width: gameWidth,
      height: gameHeight + extra,
      gameWidth,
      gameHeight,
      scaleX: scale,
      scaleY: scale,
      topGap,
      bottomGap,
      topPad: topGap / scale,
      bottomPad: bottomGap / scale,
      totalLogicalHeight: LOGICAL_HEIGHT + extra / scale,
    };
  }

  return {
    width: gameWidth,
    height: gameHeight,
    gameWidth,
    gameHeight,
    scaleX: scale,
    scaleY: scale,
    topGap: 0,
    bottomGap: 0,
    topPad: 0,
    bottomPad: 0,
    totalLogicalHeight: LOGICAL_HEIGHT,
  };
}
