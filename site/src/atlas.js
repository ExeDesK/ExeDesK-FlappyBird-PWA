import { COS, F, SIN } from './math.js';
import {
  effectiveDayNight,
  themeDefinition,
  themeLandScrollMode,
  themedSpriteName,
  validateThemeCatalog,
} from './themes.js';

const LOGICAL_WIDTH = 288;
const LOGICAL_HEIGHT = 512;
const ORIGINAL_LAND_SCROLL_PERIOD = 24;

function loadImage(url, label) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Impossible de charger ${label}`));
    image.src = url;
  });
}

function parseLegacyAtlas(text, image) {
  const sprites = {};
  const lines = text.trim().split(/\r?\n/);

  for (const line of lines) {
    const [name, ...values] = line.trim().split(/\s+/);
    const [width, height, u, v, uvWidth, uvHeight] = values.map(Number);

    if (
      values.length !== 6 ||
      values.some(value => !Number.isFinite(Number(value)))
    ) {
      throw new Error(`Ligne atlas invalide : ${name}`);
    }

    // Pixel rectangles are exact integer regions; UV decimals encode float32 values.
    const x = Math.round(F(u) * image.width);
    const y = Math.round(F(v) * image.height);

    if (
      x < 0 ||
      y < 0 ||
      x + width > image.width ||
      y + height > image.height
    ) {
      throw new Error(`Sprite hors atlas : ${name}`);
    }

    sprites[name] = {
      name,
      w: width,
      h: height,
      x,
      y,
      u: F(u),
      v: F(v),
      u2: F(F(u) + F(uvWidth)),
      v2: F(F(v) + F(uvHeight)),
    };
  }

  return sprites;
}

function parseJsonAtlas(manifest, image) {
  const sprites = {};

  if (!manifest || typeof manifest !== 'object' || !manifest.frames) {
    throw new Error('Manifest customatlas.json invalide');
  }

  for (const [name, entry] of Object.entries(manifest.frames)) {
    const frame = entry?.frame;
    const x = Number(frame?.x);
    const y = Number(frame?.y);
    const width = Number(frame?.w);
    const height = Number(frame?.h);

    if (![x, y, width, height].every(Number.isFinite)) {
      throw new Error(`Sprite custom invalide : ${name}`);
    }

    if (x < 0 || y < 0 || x + width > image.width || y + height > image.height) {
      throw new Error(`Sprite hors custom atlas : ${name}`);
    }

    sprites[name] = { name, x, y, w: width, h: height };
  }

  return sprites;
}

export async function loadAtlas() {
  const atlasImageUrl = new URL('../assets/atlas.png', import.meta.url);
  const customImageUrl = new URL('../assets/customatlas.png', import.meta.url);
  const [response, customResponse, themesResponse, image, customImage] = await Promise.all([
    fetch(new URL('../assets/atlas.txt', import.meta.url)),
    fetch(new URL('../assets/customatlas.json', import.meta.url)),
    fetch(new URL('../assets/themes.json', import.meta.url)),
    loadImage(atlasImageUrl, 'atlas.png'),
    loadImage(customImageUrl, 'customatlas.png'),
  ]);

  if (!response.ok) {
    throw new Error(`Atlas : HTTP ${response.status}`);
  }

  if (!customResponse.ok) {
    throw new Error(`Custom atlas : HTTP ${customResponse.status}`);
  }

  if (!themesResponse.ok) {
    throw new Error(`Themes : HTTP ${themesResponse.status}`);
  }

  const sprites = parseLegacyAtlas(await response.text(), image);
  const manifest = await customResponse.json();
  const themes = validateThemeCatalog(await themesResponse.json());
  const customSprites = parseJsonAtlas(manifest, customImage);

  return {
    image,
    sprites,
    themes,
    custom: {
      image: customImage,
      imageUrl: customImageUrl.href,
      sprites: customSprites,
      manifest,
    },
  };
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function cyclicDelta(a, b, period) {
  let delta = b - a;
  const halfPeriod = period / 2;

  if (delta > halfPeriod) {
    delta -= period;
  } else if (delta < -halfPeriod) {
    delta += period;
  }

  return delta;
}

export function cyclicLerp(a, b, t, period) {
  const delta = cyclicDelta(a, b, period);
  let value = a + delta * t;

  while (value <= -period) {
    value += period;
  }

  while (value > 0) {
    value -= period;
  }

  return value;
}

export function previousFor(current, index, previous) {
  if (current?.key) {
    for (const command of previous) {
      if (command?.key === current.key) {
        return command;
      }
    }

    return null;
  }

  const candidate = previous[index];
  return candidate && candidate.name === current.name ? candidate : null;
}

export class Renderer {
  constructor(canvas, atlas) {
    this.canvas = canvas;
    this.atlas = atlas;
    this.ctx = canvas.getContext('2d', { alpha: false });

    if (!this.ctx) {
      throw new Error('Canvas 2D indisponible');
    }

    this.renderScale = 2;
    this.topPad = 0;
    this.bottomPad = 0;
    this.adapted = false;
    this.theme = { theme: 'original', variant: 'auto' };
    this.landScroll = {
      pair: null,
      previous: 0,
      current: 0,
    };
    this.updateCanvasDimensions();
  }


  setTheme(theme = {}) {
    const requestedTheme = typeof theme.theme === 'string' ? theme.theme : 'original';
    this.theme = {
      theme: this.atlas.themes?.themes?.[requestedTheme] ? requestedTheme : 'original',
      variant: theme.variant === 'day' || theme.variant === 'night' ? theme.variant : 'auto',
    };

    // The native ground exposes a 24 px repeating phase. Themes using the
    // `defilement` land mode convert that phase into a renderer-only continuous
    // offset so a full-width strip can scroll before it wraps.
    this.landScroll.pair = null;
    this.landScroll.previous = 0;
    this.landScroll.current = 0;
  }

  continuousLandX(previousX, currentX, interpolation) {
    const pair = `${previousX}:${currentX}`;

    if (this.landScroll.pair !== pair) {
      const isRunReset =
        currentX === 0 &&
        previousX !== 0 &&
        previousX !== -(ORIGINAL_LAND_SCROLL_PERIOD - 2);

      if (isRunReset) {
        this.landScroll.previous = 0;
        this.landScroll.current = 0;
      } else {
        const delta = cyclicDelta(
          previousX,
          currentX,
          ORIGINAL_LAND_SCROLL_PERIOD,
        );

        this.landScroll.previous = this.landScroll.current;
        this.landScroll.current += delta;
      }

      this.landScroll.pair = pair;
    }

    return lerp(
      this.landScroll.previous,
      this.landScroll.current,
      interpolation,
    );
  }

  spriteFor(name) {
    const resolvedName = themedSpriteName(name, this.theme, this.atlas.themes);
    const customSprite = this.atlas.custom?.sprites?.[resolvedName];

    if (customSprite) {
      return {
        name: resolvedName,
        sprite: customSprite,
        image: this.atlas.custom.image,
      };
    }

    const sprite = this.atlas.sprites[resolvedName];
    return sprite ? { name: resolvedName, sprite, image: this.atlas.image } : null;
  }

  get totalLogicalHeight() {
    return LOGICAL_HEIGHT + this.topPad + this.bottomPad;
  }

  updateCanvasDimensions() {
    const scale = this.renderScale;
    const width = LOGICAL_WIDTH * scale;
    const height = Math.max(1, Math.round(this.totalLogicalHeight * scale));

    if (this.canvas.width !== width) {
      this.canvas.width = width;
    }

    if (this.canvas.height !== height) {
      this.canvas.height = height;
    }

    this.ctx.imageSmoothingEnabled = false;
  }

  configureViewport({
    topPad = 0,
    bottomPad = 0,
    adapted = false,
    renderScale = this.renderScale,
  } = {}) {
    const nextScale = Math.max(
      1,
      Math.min(3, Math.round(Number(renderScale) || 1)),
    );
    const nextTop = Math.max(0, Number(topPad) || 0);
    const nextBottom = Math.max(0, Number(bottomPad) || 0);

    const changed =
      nextScale !== this.renderScale ||
      Math.abs(nextTop - this.topPad) > 1e-6 ||
      Math.abs(nextBottom - this.bottomPad) > 1e-6 ||
      Boolean(adapted) !== this.adapted;

    this.renderScale = nextScale;
    this.topPad = nextTop;
    this.bottomPad = nextBottom;
    this.adapted = Boolean(adapted);

    if (changed) {
      this.updateCanvasDimensions();
    }

    return changed;
  }

  setRenderScale(value) {
    return this.configureViewport({
      topPad: this.topPad,
      bottomPad: this.bottomPad,
      adapted: this.adapted,
      renderScale: value,
    });
  }

  gameIdentity() {
    const scale = this.renderScale;
    this.ctx.setTransform(scale, 0, 0, scale, 0, scale * this.topPad);
  }

  canvasIdentity() {
    const scale = this.renderScale;
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  spriteTransform(x, y, angle, width, height) {
    const context = this.ctx;
    const scale = this.renderScale;
    const paddedY = y + this.topPad;

    if (angle) {
      const degree = ((Math.round(angle) % 360) + 360) % 360;
      context.setTransform(
        scale * COS[degree],
        scale * SIN[degree],
        -scale * SIN[degree],
        scale * COS[degree],
        scale * (x + width / 2),
        scale * (paddedY + height / 2),
      );
      return true;
    }

    context.setTransform(scale, 0, 0, scale, scale * x, scale * paddedY);
    return false;
  }

  sceneBackground(commands) {
    for (const command of commands) {
      if (!command?.name?.startsWith('bg_')) {
        continue;
      }

      return effectiveDayNight(command.name, this.theme.variant);
    }

    return this.theme.variant === 'night' ? 'night' : 'day';
  }

  clear(background = 'day') {
    const context = this.ctx;
    const totalHeight = this.totalLogicalHeight;

    this.canvasIdentity();
    context.globalAlpha = 1;
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#000';
    context.fillRect(0, 0, LOGICAL_WIDTH, totalHeight);

    if (!this.adapted) {
      return;
    }

    const definition = themeDefinition(this.theme, this.atlas.themes);
    context.fillStyle = background === 'night'
      ? definition.fill.skyNight
      : definition.fill.skyDay;

    if (this.topPad > 0) {
      context.fillRect(0, 0, LOGICAL_WIDTH, this.topPad + 0.5);
    }

    context.fillStyle = definition.fill.land;

    if (this.bottomPad > 0) {
      context.fillRect(
        0,
        this.topPad + LOGICAL_HEIGHT - 0.5,
        LOGICAL_WIDTH,
        this.bottomPad + 1,
      );
    }
  }

  applyOverlays(fade, flash) {
    const context = this.ctx;
    const totalHeight = this.totalLogicalHeight;

    this.canvasIdentity();

    if (fade > 0) {
      context.globalAlpha = Math.min(1, fade);
      context.fillStyle = '#000';
      context.fillRect(0, 0, LOGICAL_WIDTH, totalHeight);
    }

    if (flash > 0) {
      context.globalAlpha = Math.min(1, flash);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, LOGICAL_WIDTH, totalHeight);
    }

    context.globalAlpha = 1;
  }

  withGameClip(callback) {
    const context = this.ctx;

    this.canvasIdentity();
    context.save();
    context.beginPath();
    context.rect(0, this.topPad, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    context.clip();

    try {
      callback();
    } finally {
      context.restore();
    }
  }

  paintCommand(
    command,
    x = command.x,
    y = command.y,
    angle = command.angle,
    alpha = command.alpha,
  ) {
    const context = this.ctx;
    const resolved = this.spriteFor(command.name);

    if (!resolved) {
      throw new Error(`Sprite absent : ${command.name}`);
    }

    const { sprite, image } = resolved;

    if (alpha <= 0) {
      return;
    }

    context.globalAlpha = Math.min(1, alpha);
    context.imageSmoothingEnabled = false;

    const width = command.w ?? sprite.w;
    const height = command.h ?? sprite.h;

    if (command.key === 'land' && themeLandScrollMode(this.theme, this.atlas.themes) === 'defilement' && !angle) {
      const period = width;
      const normalized = ((x % period) + period) % period;
      const left = normalized === 0 ? 0 : normalized - period;

      for (const tileX of [left, left + period]) {
        this.spriteTransform(tileX, y, 0, width, height);
        context.drawImage(
          image,
          sprite.x,
          sprite.y,
          sprite.w,
          sprite.h,
          0,
          0,
          width,
          height,
        );
      }
      return;
    }

    const rotated = this.spriteTransform(x, y, angle, width, height);

    if (rotated) {
      context.drawImage(
        image,
        sprite.x,
        sprite.y,
        sprite.w,
        sprite.h,
        -width / 2,
        -height / 2,
        width,
        height,
      );
      return;
    }

    context.drawImage(
      image,
      sprite.x,
      sprite.y,
      sprite.w,
      sprite.h,
      0,
      0,
      width,
      height,
    );
  }

  draw(commands, debugState = null) {
    const background = this.sceneBackground(commands);
    let fade = 0;
    let flash = 0;

    this.clear(background);

    for (const command of commands) {
      if (command.name === 'black') {
        fade = Math.min(1, command.alpha);
      } else if (command.name === 'white') {
        flash = Math.min(1, command.alpha);
      }
    }

    // The original scene remains clipped to 288x512. Only upper pipes can
    // continue into the extra sky created by Adapted mode.
    this.withGameClip(() => {
      for (const command of commands) {
        if (command.name.startsWith('bg_')) {
          this.paintCommand(command);
        }
      }
    });

    if (this.adapted) {
      for (const command of commands) {
        if (command.name === 'pipe_down') {
          this.paintCommand(command);
        }
      }
    }

    this.withGameClip(() => {
      for (const command of commands) {
        const handledOutsideClip =
          this.adapted && command.name === 'pipe_down';

        if (
          command.name === 'black' ||
          command.name === 'white' ||
          command.name.startsWith('bg_') ||
          handledOutsideClip
        ) {
          continue;
        }

        this.paintCommand(command);
      }
    });

    this.applyOverlays(fade, flash);

    if (debugState) {
      this.drawDebug(debugState);
    }

    return { fade, flash, background };
  }

  drawDebug(debugState) {
    const context = this.ctx;
    const scale = this.renderScale;
    const halfPixel = 0.5 / scale;

    this.withGameClip(() => {
      this.gameIdentity();
      context.lineWidth = 1 / scale;
      context.strokeStyle = '#ff286b';
      context.strokeRect(
        debugState.bird.x + halfPixel,
        debugState.bird.y + halfPixel,
        20,
        20,
      );

      context.strokeStyle = '#00e5ff';

      if (debugState.hidden <= 0) {
        for (const pipe of debugState.pipes) {
          context.strokeRect(
            pipe.x + halfPixel,
            pipe.y + halfPixel,
            52,
            320,
          );
          context.strokeRect(
            pipe.x + halfPixel,
            pipe.y - 416 + halfPixel,
            52,
            320,
          );
        }
      }

      context.strokeStyle = '#ffe600';
      context.beginPath();
      context.moveTo(0, 400 + halfPixel);
      context.lineTo(LOGICAL_WIDTH, 400 + halfPixel);
      context.stroke();
    });

    context.globalAlpha = 1;
  }

  drawInterpolated(previous, current, alpha, debugState = null) {
    if (!Array.isArray(previous) || !Array.isArray(current)) {
      return this.draw(current ?? [], debugState);
    }

    const interpolation = Math.max(0, Math.min(1, Number(alpha) || 0));
    const background = this.sceneBackground(current);
    const values = new Array(current.length);
    let fade = 0;
    let flash = 0;

    this.clear(background);

    for (let index = 0; index < current.length; index++) {
      const command = current[index];
      const previousCommand = previousFor(command, index, previous);
      const sameCommand = Boolean(previousCommand);

      const commandAlpha =
        sameCommand &&
        Number.isFinite(previousCommand.alpha) &&
        Number.isFinite(command.alpha)
          ? lerp(previousCommand.alpha, command.alpha, interpolation)
          : command.alpha;

      if (command.name === 'black') {
        fade = Math.min(1, Math.max(0, commandAlpha));
        values[index] = null;
        continue;
      }

      if (command.name === 'white') {
        flash = Math.min(1, Math.max(0, commandAlpha));
        values[index] = null;
        continue;
      }

      let x = command.x;
      let y = command.y;

      if (
        sameCommand &&
        Number.isFinite(previousCommand.x) &&
        Number.isFinite(command.x)
      ) {
        if (command.key === 'land') {
          x = themeLandScrollMode(this.theme, this.atlas.themes) === 'defilement'
            ? this.continuousLandX(previousCommand.x, command.x, interpolation)
            : cyclicLerp(
                previousCommand.x,
                command.x,
                interpolation,
                ORIGINAL_LAND_SCROLL_PERIOD,
              );
        } else if (
          command.key?.startsWith('pipe-') &&
          Math.abs(command.x - previousCommand.x) > 8
        ) {
          x = command.x;
        } else {
          x = lerp(previousCommand.x, command.x, interpolation);
        }
      }

      if (
        sameCommand &&
        Number.isFinite(previousCommand.y) &&
        Number.isFinite(command.y)
      ) {
        y = lerp(previousCommand.y, command.y, interpolation);
      }

      const angle =
        sameCommand &&
        Number.isFinite(previousCommand.angle) &&
        Number.isFinite(command.angle)
          ? lerp(previousCommand.angle, command.angle, interpolation)
          : command.angle;

      values[index] = {
        command,
        x,
        y,
        angle,
        alpha: commandAlpha,
      };
    }

    const paint = value => {
      if (value) {
        this.paintCommand(
          value.command,
          value.x,
          value.y,
          value.angle,
          value.alpha,
        );
      }
    };

    this.withGameClip(() => {
      for (const value of values) {
        if (value?.command.name.startsWith('bg_')) {
          paint(value);
        }
      }
    });

    if (this.adapted) {
      for (const value of values) {
        if (value?.command.name === 'pipe_down') {
          paint(value);
        }
      }
    }

    this.withGameClip(() => {
      for (const value of values) {
        const handledOutsideClip =
          this.adapted && value?.command.name === 'pipe_down';

        if (
          !value ||
          value.command.name.startsWith('bg_') ||
          handledOutsideClip
        ) {
          continue;
        }

        paint(value);
      }
    });

    this.applyOverlays(fade, flash);

    if (debugState) {
      this.drawDebug(debugState);
    }

    return { fade, flash, background };
  }
}
