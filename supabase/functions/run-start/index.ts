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
      .from('verified_runs')
      .insert({
        player_id: playerId,
        seed: randomInt32(),
        physics_version: PHYSICS_VERSION,
      })
      .select('run_id,seed,physics_version,issued_at')
      .single();

    if (error || !data) {
      console.error('run-start insert failed', error);
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
