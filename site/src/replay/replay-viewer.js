import { Renderer } from '../atlas.js';
import { resolveRunTheme, themeDefinition } from '../themes.js';
import {
  VERIFIED_RUN_TAP,
  createCanonicalRunGame,
  isVerifiedRunTerminal,
} from '../verified-runs.js';

const STEP_MS = 1000 / 60;
const MAX_FRAME_DELTA_MS = 250;

function cloneCommands(commands) {
  return Array.isArray(commands)
    ? commands.map(command => ({ ...command }))
    : [];
}

function hasTheme(catalog, theme) {
  return Boolean(theme && catalog?.themes?.[theme]);
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

    this.$('close-replay')?.addEventListener('click', () => this.close());
    this.$('replay-restart')?.addEventListener('click', () => this.restart());
    this.dialog?.addEventListener('cancel', event => {
      event.preventDefault();
      this.close();
    });
    this.dialog?.addEventListener('close', () => this.stop());
  }

  async open(row) {
    if (!row?.run_id) {
      this.toast?.('Replay indisponible pour cette run.');
      return;
    }

    this.stop();
    this.row = row;
    const serial = ++this.requestSerial;

    this.$('replay-player').textContent = row.display_name || row.username || 'Joueur';
    this.$('replay-score').textContent = String(row.score ?? '—');
    this.$('replay-context').textContent = 'Chargement du contexte...';
    this.$('replay-status').textContent = 'Chargement du replay...';
    this.$('replay-restart').disabled = true;
    this.canvas.hidden = true;

    if (!this.dialog.open) this.dialog.showModal();

    try {
      const replay = await this.client.fetchReplay(row.run_id);
      if (serial !== this.requestSerial || !this.dialog.open) return;
      this.replay = replay;
      this.restart();
    } catch (error) {
      if (serial !== this.requestSerial || !this.dialog.open) return;
      console.warn('[Replay] Chargement impossible.', error);
      this.$('replay-status').textContent = typeof navigator !== 'undefined' && !navigator.onLine
        ? 'Replay indisponible hors connexion.'
        : 'Impossible de charger ce replay.';
      this.$('replay-context').textContent = 'CONTEXTE INDISPONIBLE';
      this.toast?.('Impossible de charger ce replay.', 5000);
    }
  }

  restart() {
    if (!this.replay) return;

    this.stopAnimation();
    const prepared = createCanonicalRunGame({
      seed: this.replay.seed,
      best: 0,
      onEvent: event => {
        if (event?.type === 'sound') this.audio?.play(event.value);
      },
    });

    this.game = prepared.game;
    this.tick = 0;
    this.tapSet = new Set(this.replay.taps);
    this.previousCommands = cloneCommands(this.game.commands);
    this.currentCommands = cloneCommands(this.game.commands);
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
    this.$('replay-status').textContent = 'LECTURE';
    this.$('replay-restart').disabled = true;
    this.canvas.hidden = false;
    this.renderer.draw(this.currentCommands);

    this.accumulator = 0;
    this.lastNow = 0;
    this.frameHandle = requestAnimationFrame(now => this.frame(now));
  }

  frame(now) {
    if (!this.dialog?.open || !this.game || !this.replay) {
      this.frameHandle = 0;
      return;
    }

    if (!this.lastNow) this.lastNow = now;
    const delta = Math.min(MAX_FRAME_DELTA_MS, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    this.accumulator += delta;

    let finished = false;
    while (this.accumulator >= STEP_MS && this.tick <= this.replay.terminal_tick) {
      this.accumulator -= STEP_MS;
      this.previousCommands = this.currentCommands;
      this.game.tick(this.tapSet.has(this.tick) ? { tap: VERIFIED_RUN_TAP } : {});
      this.currentCommands = cloneCommands(this.game.commands);
      this.tick++;

      if (this.tick > this.replay.terminal_tick) {
        finished = true;
        break;
      }
    }

    if (finished) {
      this.renderer.drawInterpolated(this.previousCommands, this.currentCommands, 1);
      this.finish();
      return;
    }

    this.renderer.drawInterpolated(
      this.previousCommands,
      this.currentCommands,
      Math.max(0, Math.min(1, this.accumulator / STEP_MS)),
    );
    this.frameHandle = requestAnimationFrame(next => this.frame(next));
  }

  finish() {
    this.frameHandle = 0;
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
      this.$('replay-restart').disabled = false;
      return;
    }

    this.$('replay-status').textContent = `TERMINÉ · SCORE ${this.replay.score}`;
    this.$('replay-restart').disabled = false;
  }

  stopAnimation() {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    this.lastNow = 0;
    this.accumulator = 0;
  }

  stop() {
    this.stopAnimation();
    this.requestSerial++;
    this.game = null;
    this.replay = null;
    this.tapSet = new Set();
    this.previousCommands = [];
    this.currentCommands = [];
  }

  close() {
    this.stop();
    if (this.dialog?.open) this.dialog.close();
  }
}
