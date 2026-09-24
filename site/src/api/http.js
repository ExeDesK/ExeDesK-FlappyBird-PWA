export function normalizeSupabaseConfig({ url, publishableKey } = {}) {
  return {
    url: String(url || '').replace(/\/$/, ''),
    publishableKey: String(publishableKey || ''),
  };
}

export function supabaseHeaders(publishableKey, accessToken = null) {
  const headers = {
    apikey: String(publishableKey || ''),
    Accept: 'application/json',
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

export async function responseError(response, fallback) {
  const body = await response.json().catch(() => ({}));
  const error = new Error(
    body?.message
      || body?.hint
      || (typeof body?.details === 'string' ? body.details : null)
      || body?.error_description
      || body?.error
      || body?.msg
      || fallback
      || `HTTP ${response.status}`,
  );

  error.code = body?.code || body?.error || null;
  error.details = body?.details ?? null;
  error.hint = body?.hint ?? null;

  const detailRetry = Number(body?.details?.retry_after_seconds || 0);
  const headerRetry = Number(response.headers.get('Retry-After') || 0);
  const retryAfter = Math.max(0, detailRetry || headerRetry || 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    error.retryAfterSeconds = Math.ceil(retryAfter);
  }

  return error;
}
