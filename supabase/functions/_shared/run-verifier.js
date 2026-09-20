import {
  PHYSICS_VERSION,
  parseVerifiedRunSubmission,
  simulateVerifiedRun,
} from './physics-v1/verified-runs.js';

const encoder = new TextEncoder();

export async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    encoder.encode(String(value)),
  );

  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function canonicalReplayJson(submission) {
  return JSON.stringify({
    schema: submission.schema,
    run_id: submission.run_id,
    physics_version: submission.physics_version,
    terminal_tick: submission.terminal_tick,
    taps: [...submission.taps],
  });
}

export async function inspectRunPayload(payload) {
  try {
    const submission = parseVerifiedRunSubmission(payload);
    return {
      submission,
      replay_hash: await sha256Hex(canonicalReplayJson(submission)),
      rejection_code: null,
    };
  } catch {
    return {
      submission: null,
      replay_hash: await sha256Hex(JSON.stringify(payload)),
      rejection_code: 'invalid_submission',
    };
  }
}

function simulationRejectionCode(error) {
  const message = String(error?.message || error);

  if (/Collision prématurée/i.test(message)) {
    return 'early_collision';
  }

  if (/ne se termine pas/i.test(message)) {
    return 'terminal_collision_missing';
  }

  if (/non reconnue/i.test(message)) {
    return 'collision_unknown';
  }

  return 'simulation_failed';
}

export function verifyInspectedRun({ inspection, seed, ticketPhysicsVersion }) {
  const submission = inspection.submission;

  if (!submission) {
    return {
      status: 'rejected',
      terminal_tick: null,
      tap_ticks: null,
      verified_score: null,
      collision: null,
      rejection_code: inspection.rejection_code,
    };
  }

  if (
    ticketPhysicsVersion !== PHYSICS_VERSION ||
    submission.physics_version !== ticketPhysicsVersion
  ) {
    return {
      status: 'rejected',
      terminal_tick: submission.terminal_tick,
      tap_ticks: [...submission.taps],
      verified_score: null,
      collision: null,
      rejection_code: 'physics_version_mismatch',
    };
  }

  try {
    const result = simulateVerifiedRun({
      seed,
      terminal_tick: submission.terminal_tick,
      taps: submission.taps,
    });

    return {
      status: 'verified',
      terminal_tick: result.terminal_tick,
      tap_ticks: [...submission.taps],
      verified_score: result.score,
      collision: result.collision,
      rejection_code: null,
    };
  } catch (error) {
    return {
      status: 'rejected',
      terminal_tick: submission.terminal_tick,
      tap_ticks: [...submission.taps],
      verified_score: null,
      collision: null,
      rejection_code: simulationRejectionCode(error),
    };
  }
}
