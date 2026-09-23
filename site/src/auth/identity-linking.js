export const AUTH_LINK_INTENT_KEY = 'flappy13-auth-link-intent-v1';

const AUTH_LINK_INTENT_TTL_MS = 15 * 60 * 1000;
const PROVIDER_SCOPES = Object.freeze({
  discord: 'identify email',
  google: 'openid email profile',
});

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (!/^[a-z0-9]+$/.test(value)) {
    throw new Error('Fournisseur d’authentification invalide.');
  }
  return value;
}

function normalizeIdentity(identity) {
  const provider = String(identity?.provider || '').trim().toLowerCase();
  if (!provider) return null;

  return {
    identity_id: identity?.identity_id || identity?.id || null,
    provider,
    created_at: identity?.created_at || null,
    last_sign_in_at: identity?.last_sign_in_at || null,
  };
}

export function identitiesFromUser(user, { legacyDiscordFallback = false } = {}) {
  const identities = [];
  const seen = new Set();

  for (const raw of Array.isArray(user?.identities) ? user.identities : []) {
    const identity = normalizeIdentity(raw);
    if (!identity || seen.has(identity.provider)) continue;
    seen.add(identity.provider);
    identities.push(identity);
  }

  const metadataProviders = Array.isArray(user?.app_metadata?.providers)
    ? user.app_metadata.providers
    : [user?.app_metadata?.provider].filter(Boolean);

  for (const rawProvider of metadataProviders) {
    const provider = String(rawProvider || '').trim().toLowerCase();
    if (!provider || seen.has(provider)) continue;
    seen.add(provider);
    identities.push({
      identity_id: null,
      provider,
      created_at: null,
      last_sign_in_at: null,
    });
  }

  // Before account-linking support this app only exposed Discord sign-in.
  // Old cached sessions may not contain Supabase's identities array yet.
  if (!identities.length && legacyDiscordFallback && user?.id) {
    identities.push({
      identity_id: null,
      provider: 'discord',
      created_at: null,
      last_sign_in_at: null,
      legacy: true,
    });
  }

  return identities;
}

export function providerScopes(provider, explicitScopes) {
  const normalizedProvider = normalizeProvider(provider);
  return explicitScopes ?? PROVIDER_SCOPES[normalizedProvider] ?? null;
}

export function saveLinkIntent(storage, provider, now = Date.now()) {
  if (!storage) return;
  try {
    storage.setItem(AUTH_LINK_INTENT_KEY, JSON.stringify({
      provider: normalizeProvider(provider),
      startedAt: now,
    }));
  } catch {
    // The OAuth link can still finish; only callback attribution is lost.
  }
}

export function loadLinkIntent(storage, now = Date.now()) {
  if (!storage) return null;
  try {
    const intent = safeJsonParse(storage.getItem(AUTH_LINK_INTENT_KEY));
    if (!intent?.provider || !Number.isFinite(intent?.startedAt)) {
      return null;
    }
    if (now - intent.startedAt > AUTH_LINK_INTENT_TTL_MS) {
      storage.removeItem(AUTH_LINK_INTENT_KEY);
      return null;
    }
    return {
      provider: normalizeProvider(intent.provider),
      startedAt: intent.startedAt,
    };
  } catch {
    return null;
  }
}

export function clearLinkIntent(storage) {
  try {
    storage?.removeItem(AUTH_LINK_INTENT_KEY);
  } catch {
    // Best effort.
  }
}

function authHeaders(publishableKey, accessToken) {
  return {
    apikey: publishableKey,
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

export async function requestIdentityLink({
  url,
  publishableKey,
  accessToken,
  provider,
  redirectTo,
  scopes,
  fetchImpl = fetch,
}) {
  const normalizedProvider = normalizeProvider(provider);
  const endpoint = new URL(`${String(url).replace(/\/$/, '')}/auth/v1/user/identities/authorize`);
  endpoint.searchParams.set('provider', normalizedProvider);
  endpoint.searchParams.set('redirect_to', redirectTo);
  endpoint.searchParams.set('skip_http_redirect', 'true');
  const requestedScopes = providerScopes(normalizedProvider, scopes);
  if (requestedScopes) endpoint.searchParams.set('scopes', requestedScopes);

  const response = await fetchImpl(endpoint, {
    method: 'GET',
    headers: authHeaders(publishableKey, accessToken),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.url) {
    const message = body?.msg || body?.message || body?.error_description || body?.error;
    throw new Error(message || `Liaison impossible (HTTP ${response.status}).`);
  }

  return { provider: normalizedProvider, url: body.url };
}

export async function requestIdentityUnlink({
  url,
  publishableKey,
  accessToken,
  identityId,
  fetchImpl = fetch,
}) {
  const endpoint = `${String(url).replace(/\/$/, '')}/auth/v1/user/identities/${encodeURIComponent(identityId)}`;
  const response = await fetchImpl(endpoint, {
    method: 'DELETE',
    headers: authHeaders(publishableKey, accessToken),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.msg || body?.message || body?.error_description || body?.error;
    throw new Error(message || `Suppression de la liaison impossible (HTTP ${response.status}).`);
  }
  return body;
}


export class IdentityLinkingController {
  constructor({
    url,
    publishableKey,
    storage,
    getAccessToken,
    getUser,
    getProfile,
    redirectUrl,
  } = {}) {
    this.url = String(url || '').replace(/\/$/, '');
    this.publishableKey = String(publishableKey || '');
    this.storage = storage || null;
    this.getAccessToken = getAccessToken;
    this.getUser = getUser;
    this.getProfile = getProfile;
    this.redirectUrl = redirectUrl;
  }

  identities() {
    const user = this.getUser?.() || null;
    return identitiesFromUser(user, {
      legacyDiscordFallback: Boolean(user?.id && this.getProfile?.()),
    });
  }

  providers() {
    return this.identities().map(identity => identity.provider);
  }

  saveIntent(provider) {
    saveLinkIntent(this.storage, provider);
  }

  loadIntent() {
    return loadLinkIntent(this.storage);
  }

  clearIntent() {
    clearLinkIntent(this.storage);
  }

  async link(provider, { scopes } = {}) {
    const user = this.getUser?.();
    if (!user?.id) {
      throw new Error('Connecte-toi avant de lier un autre compte.');
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Une connexion Internet est nécessaire pour lier un compte.');
    }

    const normalizedProvider = normalizeProvider(provider);
    if (this.providers().includes(normalizedProvider)) {
      throw new Error('Ce compte est déjà lié au profil.');
    }

    const accessToken = await this.getAccessToken?.();
    if (!accessToken) {
      throw new Error('Session invalide. Reconnecte-toi avant de lier un compte.');
    }

    const result = await requestIdentityLink({
      url: this.url,
      publishableKey: this.publishableKey,
      accessToken,
      provider: normalizedProvider,
      redirectTo: this.redirectUrl?.(),
      scopes,
    });

    this.saveIntent(result.provider);
    location.assign(result.url);
  }

  async unlink(identityId) {
    const user = this.getUser?.();
    if (!user?.id) {
      throw new Error('Connecte-toi avant de délier un compte.');
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Une connexion Internet est nécessaire pour délier un compte.');
    }

    const identities = this.identities();
    if (identities.length < 2) {
      throw new Error('Le dernier moyen de connexion ne peut pas être délié.');
    }

    const identity = identities.find(item => item.identity_id === identityId);
    if (!identity?.identity_id) {
      throw new Error('Identité liée introuvable.');
    }

    const accessToken = await this.getAccessToken?.();
    if (!accessToken) {
      throw new Error('Session invalide. Reconnecte-toi avant de délier un compte.');
    }

    return requestIdentityUnlink({
      url: this.url,
      publishableKey: this.publishableKey,
      accessToken,
      identityId: identity.identity_id,
    });
  }
}
