import { withSupabase } from 'npm:@supabase/server@1.7.0';

import {
  RUN_RESULT_SCHEMA,
  parseRunId,
} from '../_shared/physics-v1/verified-runs.js';
import {
  inspectRunPayload,
  verifyInspectedRun,
} from '../_shared/run-verifier.js';

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const RESULT_COLUMNS = [
  'run_id',
  'physics_version',
  'status',
  'resolved_at',
  'terminal_tick',
  'verified_score',
  'collision',
  'rejection_code',
  'replay_hash',
].join(',');

function response(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function resolvedResponse(row: Record<string, unknown>, idempotent = false) {
  return response({
    schema: RUN_RESULT_SCHEMA,
    run_id: row.run_id,
    physics_version: row.physics_version,
    status: row.status,
    terminal_tick: row.terminal_tick,
    score: row.verified_score,
    collision: row.collision,
    rejection_code: row.rejection_code,
    resolved_at: row.resolved_at,
    idempotent,
  });
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'POST') {
      return response(
        { error: 'method_not_allowed', message: 'Utilisez POST.' },
        405,
        { Allow: 'POST' },
      );
    }

    const playerId = context.userClaims?.id;
    if (!playerId) {
      return response(
        { error: 'authentication_required', message: 'Connexion requise.' },
        401,
      );
    }

    const advertisedLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(advertisedLength) && advertisedLength > MAX_REQUEST_BYTES) {
      return response(
        { error: 'payload_too_large', message: 'Replay trop volumineux.' },
        413,
      );
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return response(
        { error: 'payload_too_large', message: 'Replay trop volumineux.' },
        413,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return response(
        { error: 'invalid_json', message: 'Corps JSON invalide.' },
        400,
      );
    }

    let runId: string;
    try {
      runId = parseRunId((payload as Record<string, unknown>)?.run_id);
    } catch {
      return response(
        { error: 'invalid_run_id', message: 'run_id invalide.' },
        400,
      );
    }

    const loadRun = () => context.supabaseAdmin
      .from('verified_runs')
      .select(`player_id,seed,${RESULT_COLUMNS}`)
      .eq('run_id', runId)
      .eq('player_id', playerId)
      .maybeSingle();

    const { data: ticket, error: ticketError } = await loadRun();
    if (ticketError) {
      console.error('run-submit ticket lookup failed', ticketError);
      return response(
        { error: 'ticket_lookup_failed', message: 'Impossible de charger le run.' },
        500,
      );
    }

    if (!ticket) {
      return response(
        { error: 'run_not_found', message: 'Run introuvable pour ce joueur.' },
        404,
      );
    }

    const inspection = await inspectRunPayload(payload);

    if (ticket.status !== 'issued') {
      if (ticket.replay_hash === inspection.replay_hash) {
        return resolvedResponse(ticket, true);
      }

      return response(
        { error: 'run_already_resolved', message: 'Ce run a déjà été soumis.' },
        409,
      );
    }

    const resolution = verifyInspectedRun({
      inspection,
      seed: ticket.seed,
      ticketPhysicsVersion: ticket.physics_version,
    });
    const resolvedAt = new Date().toISOString();

    const { data: resolved, error: resolveError } = await context.supabaseAdmin
      .from('verified_runs')
      .update({
        status: resolution.status,
        submitted_at: resolvedAt,
        resolved_at: resolvedAt,
        replay_hash: inspection.replay_hash,
        terminal_tick: resolution.terminal_tick,
        tap_ticks: resolution.tap_ticks,
        verified_score: resolution.verified_score,
        collision: resolution.collision,
        rejection_code: resolution.rejection_code,
      })
      .eq('run_id', runId)
      .eq('player_id', playerId)
      .eq('status', 'issued')
      .select(RESULT_COLUMNS)
      .maybeSingle();

    if (resolveError) {
      console.error('run-submit resolution update failed', resolveError);
      return response(
        { error: 'run_resolution_failed', message: 'Impossible de résoudre le run.' },
        500,
      );
    }

    if (resolved) {
      return resolvedResponse(resolved);
    }

    // Another identical request may have won the conditional update after our
    // first read. Exact retries are idempotent; a different replay is refused.
    const { data: raced, error: racedError } = await loadRun();
    if (racedError || !raced) {
      console.error('run-submit race lookup failed', racedError);
      return response(
        { error: 'run_resolution_race', message: 'État final du run indisponible.' },
        500,
      );
    }

    if (raced.replay_hash === inspection.replay_hash) {
      return resolvedResponse(raced, true);
    }

    return response(
      { error: 'run_already_resolved', message: 'Ce run a déjà été soumis.' },
      409,
    );
  }),
};
