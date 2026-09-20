import {
  createVerifiedRunSubmission,
  isVerifiedRunTerminal,
  parseRunId,
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

function readStoredQueue(storage) {
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

function writeQueue(storage, queue) {
  if (storage) {
    storage.setItem(VERIFIED_RUN_QUEUE_KEY, JSON.stringify(queue));
  }

  return queue;
}

function normalizeQueueItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  try {
    const playerId = parseRunId(item.player_id);
    const submission = createVerifiedRunSubmission(item.submission);
    const queuedAt = String(item.queued_at || '');

    if (!queuedAt || !Number.isFinite(Date.parse(queuedAt))) {
      return null;
    }

    return {
      queued_at: queuedAt,
      player_id: playerId,
      submission: normalizedSubmission(submission),
    };
  } catch {
    return null;
  }
}

function normalizedSubmission(submission) {
  return {
    schema: submission.schema,
    run_id: submission.run_id,
    physics_version: submission.physics_version,
    terminal_tick: submission.terminal_tick,
    taps: [...submission.taps],
  };
}

export function repairPendingVerifiedRunQueue(
  storage = globalThis.localStorage,
) {
  const repairedByRun = new Map();

  for (const item of readStoredQueue(storage)) {
    const normalized = normalizeQueueItem(item);
    if (!normalized) {
      continue;
    }

    const runId = normalized.submission.run_id;
    if (repairedByRun.has(runId)) {
      repairedByRun.delete(runId);
    }
    repairedByRun.set(runId, normalized);
  }

  const repaired = [...repairedByRun.values()].slice(-MAX_PENDING_VERIFIED_RUNS);
  writeQueue(storage, repaired);
  return repaired;
}

export function pendingVerifiedRuns(storage = globalThis.localStorage) {
  return structuredClone(repairPendingVerifiedRunQueue(storage));
}

export function pendingVerifiedRunsForPlayer(
  playerId,
  storage = globalThis.localStorage,
) {
  const normalizedPlayerId = parseRunId(playerId);
  return pendingVerifiedRuns(storage).filter(
    item => item.player_id === normalizedPlayerId,
  );
}

export function removePendingVerifiedRun(
  runId,
  { storage = globalThis.localStorage } = {},
) {
  const normalizedRunId = parseRunId(runId);
  const queue = repairPendingVerifiedRunQueue(storage)
    .filter(item => item.submission.run_id !== normalizedRunId);

  writeQueue(storage, queue);
  return queue.length;
}

export function shouldDiscardVerifiedRunSubmission(error) {
  if ([400, 409, 413, 422].includes(error?.status)) {
    return true;
  }

  return error?.status === 404 && error?.code === 'run_not_found';
}

export function enqueueVerifiedRun(
  submission,
  {
    storage = globalThis.localStorage,
    queuedAt = new Date().toISOString(),
    playerId = null,
  } = {},
) {
  const normalized = createVerifiedRunSubmission(submission);
  if (playerId === null || playerId === undefined) {
    throw new TypeError('player_id requis pour une soumission de run vérifié.');
  }

  let normalizedPlayerId;
  try {
    normalizedPlayerId = parseRunId(playerId);
  } catch {
    throw new TypeError('player_id invalide.');
  }

  const queuedAtValue = String(queuedAt || '');
  if (!queuedAtValue || !Number.isFinite(Date.parse(queuedAtValue))) {
    throw new TypeError('queued_at invalide.');
  }

  const queue = repairPendingVerifiedRunQueue(storage)
    .filter(item => item.submission.run_id !== normalized.run_id);

  queue.push({
    queued_at: queuedAtValue,
    player_id: normalizedPlayerId,
    submission: normalizedSubmission(normalized),
  });

  const bounded = queue.slice(-MAX_PENDING_VERIFIED_RUNS);
  writeQueue(storage, bounded);
  return bounded.length;
}
