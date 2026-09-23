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
  return new Error(
    body?.message
      || body?.hint
      || body?.details
      || body?.error_description
      || body?.error
      || body?.msg
      || fallback
      || `HTTP ${response.status}`,
  );
}
