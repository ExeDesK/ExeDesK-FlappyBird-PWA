import { Renderer } from '../atlas.js';
import { resolveRunTheme, themeDefinition } from '../themes.js';
import {
  VERIFIED_RUN_TAP,
  createCanonicalRunGame,
  isVerifiedRunTerminal,
} from '../verified-runs.js';

const STEP_MS = 1000 / 60;
const MAX_FRAME_DELTA_MS = 250;
const REPLAY_ATLAS_PRESS_MIN_MS = 70;
const PROGRESS_WIDTH = 240;
const HANDLE_SCALE = 0.75;
const HANDLE_FRAME_TICKS = 5;
const HANDLE_FRAMES = Object.freeze(['bird2_0', 'bird2_1', 'bird2_2']);

export const REPLAY_SPEEDS = Object.freeze([1, 1.5, 2, 5]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cloneCommands(commands) {
  return Array.isArray(commands)
    ? commands.map(command => ({ ...command }))
    : [];
}

function hasTheme(catalog, theme) {
  return Boolean(theme && catalog?.themes?.[theme]);
}

function replayTotalSteps(replay) {
  return Math.max(1, Math.trunc(Number(replay?.terminal_tick) || 0) + 1);
}

export function replayProgressRatio(tick, replay) {
  return clamp((Number(tick) || 0) / replayTotalSteps(replay), 0, 1);
}

export function replayStepFromRatio(ratio, replay) {
  return Math.round(clamp(Number(ratio) || 0, 0, 1) * replayTotalSteps(replay));
}

export function replayHandleFrame(tick) {
  const frame = Math.floor(Math.max(0, Number(tick) || 0) / HANDLE_FRAME_TICKS) % HANDLE_FRAMES.length;
  return HANDLE_FRAMES[frame];
}

export function resolveReplayVisualContext({ replay, catalog, random = Math.random } = {}) {
  if (
    replay?.theme
    && (replay.variant === 'day' || replay.variant === 'night')
    && hasTheme(catalog, replay.theme)
  ) {
    return {
      theme: replay.theme,
      variant: replay.variant,
      source: 'recorded',
    };
  }

  const auto = resolveRunTheme({ mode: 'auto', catalog, random });
  return {
    theme: auto.theme,
    variant: random() < 0.5 ? 'day' : 'night',
    source: 'random',
  };
}

function visualContextLabel(context, catalog) {
  const definition = themeDefinition(context, catalog);
  const variant = context.variant === 'night' ? 'NUIT' : 'JOUR';
  return `${definition.label.toUpperCase()} · ${variant}`;
}

export class ReplayViewer {
  constructor({
    dialog,
    canvas,
    client,
    atlas,
    audio,
    getElement,
    toast,
    random = Math.random,
  } = {}) {
    this.dialog = dialog;
    this.canvas = canvas;
    this.client = client;
    this.atlas = atlas;
    this.audio = audio;
    this.$ = getElement || (id => document.getElementById(id));
    this.toast = toast;
    this.random = random;
    this.renderer = new Renderer(canvas, atlas);
    this.renderer.configureViewport({ adapted: false, renderScale: 2 });

    this.requestSerial = 0;
    this.frameHandle = 0;
    this.lastNow = 0;
    this.accumulator = 0;
    this.replay = null;
    this.row = null;
    this.game = null;
    this.tick = 0;
    this.tapSet = new Set();
    this.previousCommands = [];
    this.currentCommands = [];
    this.visualContext = null;
    this.playing = false;
    this.playbackRate = 1;
    this.hitboxes = false;
    this.scrubbing = false;
    this.resumeAfterScrub = false;
    this.suppressAudio = false;

    this.configureControlSprites();
    this.bindControls();
    this.updateControlState();

    this.$('close-replay')?.addEventListener('click', () => this.close());
    this.dialog?.addEventListener('cancel', event => {
      event.preventDefault();
      this.close();
    });
    this.dialog?.addEventListener('close', () => this.stop());
  }

  spriteSource(spriteName) {
    const customSprite = this.atlas?.custom?.sprites?.[spriteName];
    if (customSprite) {
      return {
        sprite: customSprite,
        image: this.atlas.custom.image,
        imageUrl: this.atlas.custom.imageUrl || this.atlas.custom.image?.currentSrc || this.atlas.custom.image?.src,
      };
    }

    const sprite = this.atlas?.sprites?.[spriteName];
    if (!sprite) return null;
    return {
      sprite,
      image: this.atlas.image,
      imageUrl: this.atlas.image?.currentSrc || this.atlas.image?.src,
    };
  }

  setAtlasSprite(elementId, spriteName, scale = 1) {
    const element = this.$(elementId);
    const source = this.spriteSource(spriteName);
    if (!element || !source?.sprite || !source?.image || !source.imageUrl) return;

    const { sprite, image, imageUrl } = source;
    const width = sprite.w * scale;
    const height = sprite.h * scale;

    element.dataset.sprite = spriteName;
    element.style.setProperty('--atlas-width', `${width}px`);
    element.style.setProperty('--atlas-height', `${height}px`);
    element.style.setProperty('--atlas-source-pixel', `${scale}px`);
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    element.style.backgroundImage = `url("${imageUrl}")`;
    element.style.backgroundSize = `${image.width * scale}px ${image.height * scale}px`;
    element.style.backgroundPosition = `-${sprite.x * scale}px -${sprite.y * scale}px`;
  }

  configureControlSprites() {
    this.setAtlasSprite('replay-restart-icon', 'button_restart');
    this.setAtlasSprite('replay-play-pause-icon', 'button_pause');
    this.setAtlasSprite('replay-hitbox-icon', 'button_hitbox_off');
    this.setAtlasSprite('replay-speed-1-icon', 'button_x1');
    this.setAtlasSprite('replay-speed-1-5-icon', 'button_x1_5');
    this.setAtlasSprite('replay-speed-2-icon', 'button_x2');
    this.setAtlasSprite('replay-speed-5-icon', 'button_x5');
    this.setAtlasSprite('replay-progress-track-sprite', 'replay_progress_track');
    this.setAtlasSprite('replay-progress-filled-sprite', 'replay_progress_filled');
    this.setAtlasSprite('replay-progress-handle', HANDLE_FRAMES[0], HANDLE_SCALE);
  }

  bindAtlasButtonAction(elementId, action) {
    const button = this.$(elementId);
    if (!button) return;

    let pressedAt = 0;
    let fallbackTimer = null;

    const releaseVisual = () => {
      button.classList.remove('atlas-pressed');
      pressedAt = 0;
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };

    button.addEventListener('pointerdown', event => {
      if (button.disabled || (event.button !== undefined && event.button !== 0)) return;
      pressedAt = performance.now();
      button.classList.add('atlas-pressed');
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(releaseVisual, 500);
    });

    button.addEventListener('pointercancel', releaseVisual);

    button.addEventListener('click', event => {
      if (button.disabled) return;
      if (!pressedAt) {
        pressedAt = performance.now();
        button.classList.add('atlas-pressed');
      }
      const remaining = Math.max(0, REPLAY_ATLAS_PRESS_MIN_MS - (performance.now() - pressedAt));
      window.setTimeout(() => {
        releaseVisual();
        action(event);
      }, remaining);
    });
  }

  bindControls() {
    this.bindAtlasButtonAction('replay-restart', () => this.restart());
    this.bindAtlasButtonAction('replay-play-pause', () => this.togglePlayback());
    this.bindAtlasButtonAction('replay-hitbox', () => this.toggleHitboxes());

    for (const rate of REPLAY_SPEEDS) {
      const suffix = String(rate).replace('.', '-');
      this.bindAtlasButtonAction(`replay-speed-${suffix}`, () => this.setPlaybackRate(rate));
    }

    const progress = this.$('replay-progress');
    if (!progress) return;

    progress.addEventListener('pointerdown', event => this.startScrub(event));
    progress.addEventListener('pointermove', event => this.moveScrub(event));
    progress.addEventListener('pointerup', event => this.endScrub(event));
    progress.addEventListener('pointercancel', event => this.endScrub(event, { cancelled: true }));
    progress.addEventListener('keydown', event => this.onProgressKeydown(event));
  }

  setControlsEnabled(enabled) {
    for (const id of [
      'replay-restart',
      'replay-play-pause',
      'replay-hitbox',
      'replay-speed-1',
      'replay-speed-1-5',
      'replay-speed-2',
      'replay-speed-5',
    ]) {
      const button = this.$(id);
      if (button) button.disabled = !enabled;
    }

    const progress = this.$('replay-progress');
    if (progress) {
      progress.setAttribute('aria-disabled', enabled ? 'false' : 'true');
      progress.tabIndex = enabled ? 0 : -1;
    }
  }

  async open(row) {
    if (!row?.run_id) {
      this.toast?.('Replay indisponible pour cette run.');
      return;
    }

    this.stop();
    this.row = row;
    this.playbackRate = 1;
    this.hitboxes = false;
    this.updateControlState();
    this.setControlsEnabled(false);
    this.updateProgress();
    const serial = ++this.requestSerial;

    this.$('replay-player').textContent = row.display_name || row.username || 'Joueur';
    this.$('replay-score').textContent = String(row.score ?? '—');
    this.$('replay-context').textContent = 'Chargement du contexte...';
    this.$('replay-status').textContent = 'Chargement du replay...';
    this.canvas.hidden = true;

    if (!this.dialog.open) this.dialog.showModal();

    try {
      const replay = await this.client.fetchReplay(row.run_id);
      if (serial !== this.requestSerial || !this.dialog.open) return;
      this.replay = replay;
      this.setControlsEnabled(true);
      this.restart();
    } catch (error) {
      if (serial !== this.requestSerial || !this.dialog.open) return;
      console.warn('[Replay] Chargement impossible.', error);

      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      const rateLimited = error?.status === 429 || error?.code === 'rate_limited';
      const authRequired = error?.status === 401 || error?.status === 403
        || /connexion requise|authentication_required/i.test(String(error?.message || ''));
      const retry = Number(error?.retryAfterSeconds || 0);

      const message = offline
        ? 'Replay indisponible hors connexion.'
        : authRequired
          ? 'Connectez-vous pour visionner les replays.'
          : rateLimited
            ? (retry > 0
              ? `Trop de replays ouverts. Réessayez dans ${retry} s.`
              : 'Trop de replays ouverts. Réessayez dans quelques instants.')
            : 'Impossible de charger ce replay.';

      this.$('replay-status').textContent = message;
      this.$('replay-context').textContent = 'CONTEXTE INDISPONIBLE';
      this.toast?.(message, 5000);
    }
  }

  createSimulation() {
    const prepared = createCanonicalRunGame({
      seed: this.replay.seed,
      best: 0,
      onEvent: event => {
        if (!this.suppressAudio && event?.type === 'sound') this.audio?.play(event.value);
      },
    });

    this.game = prepared.game;
    this.tick = 0;
    this.previousCommands = cloneCommands(this.game.commands);
    this.currentCommands = cloneCommands(this.game.commands);
  }

  restart() {
    if (!this.replay) return;

    this.cancelAnimation({ resetAccumulator: true });
    this.tapSet = new Set(this.replay.taps);
    this.createSimulation();
    this.visualContext = resolveReplayVisualContext({
      replay: this.replay,
      catalog: this.atlas.themes,
      random: this.random,
    });
    this.renderer.setTheme(this.visualContext);

    const contextLabel = visualContextLabel(this.visualContext, this.atlas.themes);
    this.$('replay-context').textContent = this.visualContext.source === 'recorded'
      ? contextLabel
      : `${contextLabel} · CONTEXTE ANCIEN ALÉATOIRE`;
    this.canvas.hidden = false;
    this.playing = true;
    this.drawCurrent(1);
    this.updateControlState();
    this.updateStatus();
    this.frameHandle = requestAnimationFrame(now => this.frame(now));
  }

  tickSimulationOnce() {
    this.previousCommands = this.currentCommands;
    this.game.tick(this.tapSet.has(this.tick) ? { tap: VERIFIED_RUN_TAP } : {});
    this.currentCommands = cloneCommands(this.game.commands);
    this.tick++;
  }

  drawCurrent(alpha = 1) {
    if (!this.game) return;
    this.renderer.drawInterpolated(
      this.previousCommands,
      this.currentCommands,
      alpha,
      this.hitboxes ? this.game.snapshot() : null,
    );
    this.updateProgress();
  }

  frame(now) {
    if (!this.dialog?.open || !this.game || !this.replay || !this.playing) {
      this.frameHandle = 0;
      return;
    }

    if (!this.lastNow) this.lastNow = now;
    const delta = Math.min(MAX_FRAME_DELTA_MS, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    this.accumulator += delta * this.playbackRate;

    let finished = false;
    while (this.accumulator >= STEP_MS && this.tick <= this.replay.terminal_tick) {
      this.accumulator -= STEP_MS;
      this.tickSimulationOnce();

      if (this.tick > this.replay.terminal_tick) {
        finished = true;
        break;
      }
    }

    if (finished) {
      this.drawCurrent(1);
      this.finish();
      return;
    }

    this.drawCurrent(clamp(this.accumulator / STEP_MS, 0, 1));
    this.frameHandle = requestAnimationFrame(next => this.frame(next));
  }

  finish() {
    this.frameHandle = 0;
    this.playing = false;
    this.lastNow = 0;
    this.accumulator = 0;
    const validTerminal = isVerifiedRunTerminal(this.game);
    const validScore = this.game?.score === this.replay?.score;

    if (!validTerminal || !validScore) {
      console.error('[Replay] Divergence locale lors de la relecture.', {
        run_id: this.replay?.run_id,
        expected_score: this.replay?.score,
        actual_score: this.game?.score,
        terminal: validTerminal,
      });
      this.$('replay-status').textContent = 'REPLAY INCOMPATIBLE AVEC CETTE BUILD';
      this.updateControlState();
      return;
    }

    this.$('replay-status').textContent = `TERMINÉ · SCORE ${this.replay.score}`;
    this.updateControlState();
    this.updateProgress();
  }

  cancelAnimation({ resetAccumulator = false } = {}) {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    this.lastNow = 0;
    if (resetAccumulator) this.accumulator = 0;
  }

  pause({ updateStatus = true } = {}) {
    if (!this.replay || !this.game || !this.playing) return;
    this.cancelAnimation();
    this.playing = false;
    this.updateControlState();
    if (updateStatus) this.updateStatus();
  }

  resume() {
    if (!this.replay || !this.game || this.playing) return;
    if (this.tick >= replayTotalSteps(this.replay)) {
      this.restart();
      return;
    }
    this.playing = true;
    this.lastNow = 0;
    this.updateControlState();
    this.updateStatus();
    this.frameHandle = requestAnimationFrame(now => this.frame(now));
  }

  togglePlayback() {
    if (this.playing) this.pause();
    else this.resume();
  }

  setPlaybackRate(rate) {
    if (!REPLAY_SPEEDS.includes(rate)) return;
    this.playbackRate = rate;
    this.updateControlState();
    this.updateStatus();
  }

  toggleHitboxes() {
    if (!this.game) return;
    this.hitboxes = !this.hitboxes;
    this.updateControlState();
    this.drawCurrent(this.playing ? clamp(this.accumulator / STEP_MS, 0, 1) : 1);
  }

  updateStatus() {
    if (!this.replay || !this.game) return;
    if (this.tick >= replayTotalSteps(this.replay)) return;
    const rate = Number.isInteger(this.playbackRate)
      ? String(this.playbackRate)
      : String(this.playbackRate).replace('.', ',');
    this.$('replay-status').textContent = `${this.playing ? 'LECTURE' : 'PAUSE'} · ×${rate}`;
  }

  updateControlState() {
    const playButton = this.$('replay-play-pause');
    if (playButton) {
      const label = this.playing ? 'Mettre le replay en pause' : 'Lire le replay';
      playButton.setAttribute('aria-label', label);
      playButton.title = label;
      playButton.setAttribute('aria-pressed', this.playing ? 'true' : 'false');
    }
    this.setAtlasSprite('replay-play-pause-icon', this.playing ? 'button_pause' : 'button_resume');

    const hitboxButton = this.$('replay-hitbox');
    if (hitboxButton) {
      hitboxButton.setAttribute('aria-pressed', this.hitboxes ? 'true' : 'false');
      hitboxButton.title = this.hitboxes ? 'Masquer les hitbox' : 'Afficher les hitbox';
      hitboxButton.setAttribute('aria-label', hitboxButton.title);
      hitboxButton.classList.toggle('is-selected', this.hitboxes);
    }
    this.setAtlasSprite('replay-hitbox-icon', this.hitboxes ? 'button_hitbox_on' : 'button_hitbox_off');

    for (const rate of REPLAY_SPEEDS) {
      const suffix = String(rate).replace('.', '-');
      const button = this.$(`replay-speed-${suffix}`);
      const selected = this.playbackRate === rate;
      if (button) {
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        button.classList.toggle('is-selected', selected);
      }
    }
  }

  updateProgress() {
    const ratio = replayProgressRatio(this.tick, this.replay);
    const pixels = ratio * PROGRESS_WIDTH;
    const fillClip = this.$('replay-progress-fill-clip');
    const handle = this.$('replay-progress-handle');
    const progress = this.$('replay-progress');

    if (fillClip) fillClip.style.width = `${pixels}px`;
    if (handle) {
      handle.style.left = `${pixels}px`;
      this.setAtlasSprite('replay-progress-handle', replayHandleFrame(this.tick), HANDLE_SCALE);
    }
    if (progress) {
      const total = replayTotalSteps(this.replay);
      const current = clamp(this.tick, 0, total);
      progress.setAttribute('aria-valuemin', '0');
      progress.setAttribute('aria-valuemax', String(total));
      progress.setAttribute('aria-valuenow', String(current));
      progress.setAttribute('aria-valuetext', `${(current / 60).toFixed(2)} s sur ${(total / 60).toFixed(2)} s`);
    }
  }

  progressRatioFromClientX(clientX) {
    const progress = this.$('replay-progress');
    const rect = progress?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }

  startScrub(event) {
    if (!this.replay || !this.game || event.button !== 0) return;
    event.preventDefault();
    this.scrubbing = true;
    this.resumeAfterScrub = this.playing;
    this.pause({ updateStatus: false });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    this.seekToStep(replayStepFromRatio(this.progressRatioFromClientX(event.clientX), this.replay));
    this.updateStatus();
  }

  moveScrub(event) {
    if (!this.scrubbing || !this.replay || !this.game) return;
    event.preventDefault();
    this.seekToStep(replayStepFromRatio(this.progressRatioFromClientX(event.clientX), this.replay));
  }

  endScrub(event, { cancelled = false } = {}) {
    if (!this.scrubbing) return;
    if (!cancelled && this.replay && this.game) {
      this.seekToStep(replayStepFromRatio(this.progressRatioFromClientX(event.clientX), this.replay));
    }
    this.scrubbing = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const shouldResume = this.resumeAfterScrub && this.tick < replayTotalSteps(this.replay);
    this.resumeAfterScrub = false;
    if (shouldResume) this.resume();
    else this.updateStatus();
  }

  onProgressKeydown(event) {
    if (!this.replay || !this.game) return;
    const total = replayTotalSteps(this.replay);
    let target = null;
    if (event.key === 'ArrowLeft') target = this.tick - 60;
    if (event.key === 'ArrowRight') target = this.tick + 60;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = total;
    if (target === null) return;

    event.preventDefault();
    const wasPlaying = this.playing;
    this.pause({ updateStatus: false });
    this.seekToStep(clamp(target, 0, total));
    if (wasPlaying && this.tick < total) this.resume();
    else this.updateStatus();
  }

  seekToStep(targetStep) {
    if (!this.replay || !this.game) return;
    const total = replayTotalSteps(this.replay);
    const target = clamp(Math.round(targetStep), 0, total);

    this.suppressAudio = true;
    try {
      if (target < this.tick) {
        this.createSimulation();
      }
      while (this.tick < target && this.tick <= this.replay.terminal_tick) {
        this.tickSimulationOnce();
      }
    } finally {
      this.suppressAudio = false;
    }

    this.accumulator = 0;
    this.lastNow = 0;
    this.drawCurrent(1);

    if (this.tick >= total) {
      this.finish();
    }
  }

  stop() {
    this.cancelAnimation({ resetAccumulator: true });
    this.requestSerial++;
    this.game = null;
    this.replay = null;
    this.tapSet = new Set();
    this.previousCommands = [];
    this.currentCommands = [];
    this.playing = false;
    this.scrubbing = false;
    this.resumeAfterScrub = false;
    this.suppressAudio = false;
    this.updateControlState();
    this.updateProgress();
  }

  close() {
    this.stop();
    if (this.dialog?.open) this.dialog.close();
  }
}
