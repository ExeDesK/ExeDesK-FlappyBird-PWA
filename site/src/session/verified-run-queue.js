import {
  createVerifiedRunSubmission,
  parseRunId,
} from '../verified-runs.js';

export const VERIFIED_RUN_QUEUE_KEY = 'flappy13-verified-run-queue-v1';
export const MAX_PENDING_VERIFIED_RUNS = 50;

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function storageOrDefault(storage) {
  return storage === undefined ? browserStorage() : storage;
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

function normalizedSubmission(submission) {
  return {
    schema: submission.schema,
    run_id: submission.run_id,
    physics_version: submission.physics_version,
    terminal_tick: submission.terminal_tick,
    taps: [...submission.taps],
  };
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

export function repairPendingVerifiedRunQueue(storage = undefined) {
  storage = storageOrDefault(storage);
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

export function pendingVerifiedRuns(storage = undefined) {
  storage = storageOrDefault(storage);
  return structuredClone(repairPendingVerifiedRunQueue(storage));
}

export function pendingVerifiedRunsForPlayer(
  playerId,
  storage = undefined,
) {
  storage = storageOrDefault(storage);
  const normalizedPlayerId = parseRunId(playerId);
  return pendingVerifiedRuns(storage).filter(
    item => item.player_id === normalizedPlayerId,
  );
}

export function removePendingVerifiedRun(
  runId,
  { storage = undefined } = {},
) {
  storage = storageOrDefault(storage);
  const normalizedRunId = parseRunId(runId);
  const queue = repairPendingVerifiedRunQueue(storage)
    .filter(item => item.submission.run_id !== normalizedRunId);

  writeQueue(storage, queue);
  return queue.length;
}

export function enqueueVerifiedRun(
  submission,
  {
    storage = undefined,
    queuedAt = new Date().toISOString(),
    playerId = null,
  } = {},
) {
  storage = storageOrDefault(storage);
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

export class VerifiedRunQueue {
  constructor({ storage = undefined } = {}) {
    this.storage = storage;
  }

  repair() {
    return repairPendingVerifiedRunQueue(this.storage);
  }

  all() {
    return pendingVerifiedRuns(this.storage);
  }

  forPlayer(playerId) {
    return pendingVerifiedRunsForPlayer(playerId, this.storage);
  }

  enqueue(submission, options = {}) {
    return enqueueVerifiedRun(submission, {
      ...options,
      storage: this.storage,
    });
  }

  remove(runId) {
    return removePendingVerifiedRun(runId, { storage: this.storage });
  }
}
