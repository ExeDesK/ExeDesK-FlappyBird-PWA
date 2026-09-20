import { Game } from './game.js';
import { overlaps } from './math.js';

export const PHYSICS_VERSION = 'flappy13-physics-v1';
export const RUN_TICKET_SCHEMA = 'flappy13-run-ticket-v1';
export const VERIFIED_RUN_SCHEMA = 'flappy13-verified-run-v1';

// One hour at 60 Hz. This bounds future server replay work while remaining far
// beyond a realistic human run. It is part of the versioned replay contract.
export const MAX_VERIFIED_RUN_TICK = 60 * 60 * 60;
export const MAX_VERIFIED_RUN_TAPS = MAX_VERIFIED_RUN_TICK + 1;

export const VERIFIED_RUN_TAP = Object.freeze({ x: 144, y: 256 });

const PLAY_TOUCH = Object.freeze({ x: 78, y: 375 });
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const PREPARE_GUARD_TICKS = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} invalide.`);
  }

  return value;
}

function requireInt32(value, label) {
  if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) {
    throw new TypeError(`${label} doit être un entier signé 32 bits.`);
  }

  return value;
}

function requireRunId(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError('run_id invalide.');
  }

  return value.toLowerCase();
}

function requirePhysicsVersion(value) {
  if (value !== PHYSICS_VERSION) {
    throw new RangeError(`physics_version non supportée : ${String(value)}.`);
  }

  return value;
}

function requireRunTick(value, label = 'terminal_tick') {
  if (!Number.isInteger(value) || value < 0 || value > MAX_VERIFIED_RUN_TICK) {
    throw new RangeError(
      `${label} doit être compris entre 0 et ${MAX_VERIFIED_RUN_TICK}.`,
    );
  }

  return value;
}

export function parseRunTicket(payload) {
  const value = requireObject(payload, 'Ticket de run');

  if (value.schema !== RUN_TICKET_SCHEMA) {
    throw new TypeError('Schéma de ticket de run non supporté.');
  }

  const issuedAt = String(value.issued_at || '');
  if (!issuedAt || !Number.isFinite(Date.parse(issuedAt))) {
    throw new TypeError('issued_at invalide.');
  }

  return Object.freeze({
    schema: RUN_TICKET_SCHEMA,
    run_id: requireRunId(value.run_id),
    seed: requireInt32(value.seed, 'seed'),
    physics_version: requirePhysicsVersion(value.physics_version),
    issued_at: issuedAt,
  });
}

export function validateTapTicks(taps, terminalTick) {
  requireRunTick(terminalTick);

  if (!Array.isArray(taps) || taps.length === 0) {
    throw new TypeError('Le replay doit contenir au moins le tap initial.');
  }

  if (taps.length > MAX_VERIFIED_RUN_TAPS) {
    throw new RangeError('Le replay contient trop de taps.');
  }

  const normalized = [];
  let previous = -1;

  for (const value of taps) {
    const tick = requireRunTick(value, 'Tick de tap');

    if (tick <= previous) {
      throw new RangeError('Les ticks de tap doivent être strictement croissants.');
    }

    if (tick > terminalTick) {
      throw new RangeError('Un tap ne peut pas dépasser terminal_tick.');
    }

    normalized.push(tick);
    previous = tick;
  }

  if (normalized[0] !== 0) {
    throw new RangeError('Le premier tap d’un run vérifié doit être au tick 0.');
  }

  return Object.freeze(normalized);
}

export function createVerifiedRunSubmission({
  run_id: runId,
  physics_version: physicsVersion,
  terminal_tick: terminalTick,
  taps,
} = {}) {
  const normalizedTerminalTick = requireRunTick(terminalTick);

  return Object.freeze({
    schema: VERIFIED_RUN_SCHEMA,
    run_id: requireRunId(runId),
    physics_version: requirePhysicsVersion(physicsVersion),
    terminal_tick: normalizedTerminalTick,
    taps: validateTapTicks(taps, normalizedTerminalTick),
  });
}

function advanceUntil(game, predicate, label) {
  for (let count = 0; count <= PREPARE_GUARD_TICKS; count++) {
    if (predicate(game)) {
      return;
    }

    game.tick();
  }

  throw new Error(`État canonique inaccessible : ${label}.`);
}

/**
 * Rebuild the exact APK/harness start state for a fresh seed.
 *
 * The ordinary Game lifecycle deliberately preserves RNG and pipe positions
 * between retries. A verified run must instead begin from a new Game instance,
 * traverse the original menu/PLAY transition, then stop on settled READY.
 */
export function createCanonicalRunGame({
  seed,
  best = 0,
  onEvent = () => {},
} = {}) {
  const normalizedSeed = requireInt32(seed, 'seed');

  if (!Number.isInteger(best) || best < 0 || best > INT32_MAX) {
    throw new TypeError('best doit être un entier positif signé 32 bits.');
  }

  if (typeof onEvent !== 'function') {
    throw new TypeError('onEvent doit être une fonction.');
  }

  // Preparation is silent: menu sounds and temporary record events are not
  // part of the ranked run and must not leak into the active UI/session.
  const game = new Game({ seed: normalizedSeed, best: 0 });

  advanceUntil(
    game,
    current => current.menu && current.play.active && current.fade.done && current.fade.value === 0,
    'MENU',
  );

  game.tick({ touches: [PLAY_TOUCH] });
  game.tick({ touches: [] });

  advanceUntil(
    game,
    current => current.ready.active && current.ready.stage === 1 && current.bird.idle && !current.menu,
    'READY',
  );

  const warmupFrames = game.frame;
  game.best = best;
  game.onEvent = onEvent;
  game.replay = [];
  game.outputs = [];

  return { game, warmupFrames };
}

export function isVerifiedRunTerminal(game) {
  return Boolean(game) && game.speed === 0 && !game.bird.idle;
}

export function verifiedRunCollision(game) {
  if (!isVerifiedRunTerminal(game)) {
    return null;
  }

  const { bird } = game;
  if (bird.y >= 380) {
    return 'ground';
  }

  for (const pipe of game.pipes) {
    if (overlaps(bird.x, bird.y, 20, 20, pipe.x, pipe.y - 416, 52, 320)) {
      return 'upper-pipe';
    }

    if (overlaps(bird.x, bird.y, 20, 20, pipe.x, pipe.y, 52, 320)) {
      return 'lower-pipe';
    }
  }

  return 'unknown';
}

/**
 * Pure authoritative replay core. Network submission is intentionally kept
 * outside this module so the browser tests and the future Edge Function can
 * exercise exactly the same deterministic contract.
 */
export function simulateVerifiedRun({ seed, terminal_tick: terminalTick, taps } = {}) {
  const normalizedSeed = requireInt32(seed, 'seed');
  const normalizedTerminalTick = requireRunTick(terminalTick);
  const normalizedTaps = validateTapTicks(taps, normalizedTerminalTick);
  const tapSet = new Set(normalizedTaps);
  const { game, warmupFrames } = createCanonicalRunGame({ seed: normalizedSeed });

  for (let tick = 0; tick <= normalizedTerminalTick; tick++) {
    game.tick(tapSet.has(tick) ? { tap: VERIFIED_RUN_TAP } : {});

    if (isVerifiedRunTerminal(game)) {
      if (tick !== normalizedTerminalTick) {
        throw new Error(`Collision prématurée au tick ${tick}.`);
      }

      const collision = verifiedRunCollision(game);
      if (collision === 'unknown') {
        throw new Error('Collision terminale non reconnue.');
      }

      return Object.freeze({
        score: game.score,
        terminal_tick: tick,
        collision,
        warmup_frames: warmupFrames,
        snapshot: game.snapshot(),
      });
    }
  }

  throw new Error('Le replay ne se termine pas au terminal_tick annoncé.');
}
