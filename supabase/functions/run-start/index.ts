import { withSupabase } from 'npm:@supabase/server@1.7.0';

const PHYSICS_VERSION = 'flappy13-physics-v1';
const RUN_TICKET_SCHEMA = 'flappy13-run-ticket-v1';

function response(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function randomInt32() {
  const values = new Int32Array(1);
  crypto.getRandomValues(values);
  return values[0];
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

    const { data, error } = await context.supabaseAdmin
      .rpc('issue_verified_run', {
        target_player_id: playerId,
        requested_seed: randomInt32(),
        requested_physics_version: PHYSICS_VERSION,
      })
      .single();

    if (error || !data) {
      console.error('run-start issue_verified_run failed', error);
      return response(
        { error: 'ticket_creation_failed', message: 'Impossible de créer le run classé.' },
        500,
      );
    }

    if (data.result_code === 'too_many_pending_runs') {
      return response(
        {
          error: 'too_many_pending_runs',
          message: 'Trop de parties classées sont encore en attente pour ce compte.',
          pending_runs: data.pending_count,
        },
        429,
      );
    }

    if (data.result_code === 'rate_limited') {
      const retryAfter = Math.max(1, Number(data.retry_after_seconds) || 60);
      return response(
        {
          error: 'rate_limited',
          message: 'Trop de parties classées ont été démarrées récemment. Réessayez dans quelques instants.',
          retry_after_seconds: retryAfter,
        },
        429,
        { 'Retry-After': String(retryAfter) },
      );
    }

    if (data.result_code !== 'issued' || !data.run_id) {
      console.error('run-start unexpected issue result', data);
      return response(
        { error: 'ticket_creation_failed', message: 'Impossible de créer le run classé.' },
        500,
      );
    }

    return response({
      schema: RUN_TICKET_SCHEMA,
      run_id: data.run_id,
      seed: data.seed,
      physics_version: data.physics_version,
      issued_at: data.issued_at,
    }, 201);
  }),
};
