import {
  createVerifiedRunSubmission,
  isVerifiedRunTerminal,
} from './verified-runs.js';

export const VERIFIED_RUN_QUEUE_KEY = 'flappy13-verified-run-queue-v1';
export const MAX_PENDING_VERIFIED_RUNS = 50;

export function verifiedRunStartMode({ hasSession = false, online = true } = {}) {
  if (!hasSession) {
    return 'local';
  }

  return online ? 'ticket' : 'warn-offline';
}

export function isPlayRelease(game, input = {}) {
  if (!game?.play?.active || !game.play.pressed) {
    return false;
  }

  const touches = Array.isArray(input.touches) ? input.touches : [];
  return !touches.some(point =>
    point.x > game.play.x &&
    point.x < game.play.x + game.play.w &&
    point.y > game.play.y &&
    point.y < game.play.y + game.play.h
  );
}

function isEffectiveTap(game, tap) {
  if (!game || !tap || game.menu || game.bird.dead || game.bird.y < 0) {
    return false;
  }

  if (tap.x >= -20 && tap.x <= 46 && tap.y >= -20 && tap.y <= 48) {
    return false;
  }

  if (game.bird.idle) {
    return game.ready.active && game.ready.stage === 1;
  }

  return game.speed > 0;
}

export class VerifiedRunRecorder {
  constructor(ticket) {
    this.ticket = ticket;
    this.started = false;
    this.finished = false;
    this.tick = -1;
    this.taps = [];
    this.submission = null;
  }

  beforeTick(game, input = {}) {
    if (this.finished) {
      return;
    }

    const effectiveTap = isEffectiveTap(game, input.tap);

    if (!this.started) {
      if (!effectiveTap) {
        return;
      }

      this.started = true;
      this.tick = 0;
      this.taps.push(0);
      return;
    }

    this.tick++;
    if (effectiveTap) {
      this.taps.push(this.tick);
    }
  }

  afterTick(game) {
    if (!this.started || this.finished || !isVerifiedRunTerminal(game)) {
      return null;
    }

    this.submission = createVerifiedRunSubmission({
      run_id: this.ticket.run_id,
      physics_version: this.ticket.physics_version,
      terminal_tick: this.tick,
      taps: this.taps,
    });
    this.finished = true;
    return this.submission;
  }

  snapshot() {
    return {
      run_id: this.ticket.run_id,
      physics_version: this.ticket.physics_version,
      started: this.started,
      finished: this.finished,
      tick: this.tick,
      taps: [...this.taps],
      submission: this.submission ? structuredClone(this.submission) : null,
    };
  }
}

function readQueue(storage) {
  if (!storage) {
    return [];
  }

  try {
    const value = JSON.parse(storage.getItem(VERIFIED_RUN_QUEUE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function pendingVerifiedRuns(storage = globalThis.localStorage) {
  return structuredClone(readQueue(storage));
}

export function enqueueVerifiedRun(
  submission,
  { storage = globalThis.localStorage, queuedAt = new Date().toISOString() } = {},
) {
  const normalized = createVerifiedRunSubmission(submission);
  const queue = readQueue(storage)
    .filter(item => item?.submission?.run_id !== normalized.run_id);

  queue.push({
    queued_at: queuedAt,
    submission: normalized,
  });

  const bounded = queue.slice(-MAX_PENDING_VERIFIED_RUNS);
  storage.setItem(VERIFIED_RUN_QUEUE_KEY, JSON.stringify(bounded));
  return bounded.length;
}
