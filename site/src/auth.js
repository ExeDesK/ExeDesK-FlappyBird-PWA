import { AUTH_LINK_INTENT_KEY, IdentityLinkingController, identitiesFromUser, normalizeProvider, providerScopes } from './auth/identity-linking.js';
import { ProfileClient, profileFromUser } from './api/profile-client.js';
const AUTH_STORAGE_KEY = 'flappy13-auth-v1';
const SESSION_SKEW_MS = 60 * 1000;

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
export class AuthClient {
  constructor({ url, publishableKey, storage } = {}) {
    this.url = String(url || '').replace(/\/$/, '');
    this.publishableKey = String(publishableKey || '');
    this.storage = storage === undefined ? defaultStorage() : storage;
    this.session = null;
    this.user = null;
    this.profile = null;
    this.status = 'signed_out';
    this.error = null;
    this.callbackResult = null;
    this.callbackProvider = null;
    this.listeners = new Set();
    this.profileClient = new ProfileClient({ url: this.url, publishableKey: this.publishableKey });
    this.identityLinking = new IdentityLinkingController({
      url: this.url, publishableKey: this.publishableKey, storage: this.storage,
      getAccessToken: () => this._validAccessToken(), getUser: () => this.user,
      getProfile: () => this.profile, redirectUrl: () => this._redirectUrl(),
    });
  }

  get configured() {
    return Boolean(this.url && this.publishableKey);
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return {
      configured: this.configured,
      status: this.status,
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      user: this.user ? structuredClone(this.user) : null,
      profile: this.profile ? structuredClone(this.profile) : null,
      identities: structuredClone(this.linkedIdentities()),
      error: this.error,
      callbackResult: this.callbackResult,
      callbackProvider: this.callbackProvider,
    };
  }

  _emit() {
    const state = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // UI listeners must never break auth state handling.
      }
    }
  }

  _setStatus(status, error = null) {
    this.status = status;
    this.error = error ? String(error?.message || error) : null;
    this._emit();
  }

  _save() {
    if (!this.storage) return;

    try {
      if (!this.session) {
        this.storage.removeItem(AUTH_STORAGE_KEY);
        return;
      }

      this.storage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
        session: this.session,
        user: this.user,
        profile: this.profile,
      }));
    } catch {
      // Auth still works for the current page if storage is unavailable.
    }
  }

  _load() {
    if (!this.storage) return;

    let stored = null;
    try {
      stored = safeJsonParse(this.storage.getItem(AUTH_STORAGE_KEY));
    } catch {
      stored = null;
    }

    if (!stored?.session?.accessToken || !stored?.session?.refreshToken) {
      return;
    }

    this.session = stored.session;
    this.user = stored.user || null;
    this.profile = stored.profile || null;
  }

  _clearLocal() {
    this.session = null;
    this.user = null;
    this.profile = null;
    this.callbackResult = null;
    this.callbackProvider = null;
    try {
      this.storage?.removeItem(AUTH_STORAGE_KEY);
      this.identityLinking.clearIntent();
    } catch {
      // Best effort.
    }
  }

  linkedIdentities() {
    return this.identityLinking.identities();
  }

  _authHeaders(accessToken = null) {
    const headers = {
      apikey: this.publishableKey,
      Accept: 'application/json',
    };

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    return headers;
  }

  _redirectUrl() {
    return `${location.origin}${location.pathname}`;
  }

  _parseCallback() {
    if (!location.hash || location.hash.length < 2) {
      return false;
    }

    const params = new URLSearchParams(location.hash.slice(1));
    const linkIntent = this.identityLinking.loadIntent();
    const error = params.get('error_description') || params.get('error');

    if (error) {
      this.callbackResult = linkIntent ? 'identity_link_error' : 'error';
      this.callbackProvider = linkIntent?.provider || params.get('provider') || null;
      this.error = error;
      this.identityLinking.clearIntent();
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      return true;
    }

    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken || !refreshToken) {
      return false;
    }

    const expiresIn = Number(params.get('expires_in')) || 3600;
    this.session = {
      accessToken,
      refreshToken,
      tokenType: params.get('token_type') || 'bearer',
      expiresAt: Date.now() + expiresIn * 1000,
    };
    this.callbackResult = linkIntent ? 'identity_linked' : 'signed_in';
    this.callbackProvider = linkIntent?.provider || params.get('provider') || null;
    this.identityLinking.clearIntent();
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    this._save();
    return true;
  }

  async init() {
    if (!this.configured) {
      this._setStatus('unavailable', 'Supabase non configuré.');
      return this.snapshot();
    }

    this._parseCallback();
    if (!this.session) {
      this._load();
    }

    if (!this.session) {
      this._setStatus(this.callbackResult === 'error' ? 'error' : 'signed_out', this.error);
      return this.snapshot();
    }

    await this.sync({ reason: 'startup' });
    return this.snapshot();
  }

  signInWithProvider(provider, { scopes } = {}) {
    if (!this.configured) {
      throw new Error('Authentification non configurée.');
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Une connexion Internet est nécessaire pour se connecter.');
    }

    const normalizedProvider = normalizeProvider(provider);
    this.identityLinking.clearIntent();
    const authorize = new URL(`${this.url}/auth/v1/authorize`);
    authorize.searchParams.set('provider', normalizedProvider);
    authorize.searchParams.set('redirect_to', this._redirectUrl());
    const requestedScopes = providerScopes(normalizedProvider, scopes);
    if (requestedScopes) {
      authorize.searchParams.set('scopes', requestedScopes);
    }
    location.assign(authorize.href);
  }

  signInWithDiscord() {
    return this.signInWithProvider('discord');
  }

  linkIdentity(provider, options = {}) {
    if (!this.configured) {
      return Promise.reject(new Error('Authentification non configurée.'));
    }
    return this.identityLinking.link(provider, options);
  }

  async unlinkIdentity(identityId) {
    const body = await this.identityLinking.unlink(identityId);
    if (body?.user) {
      this.user = body.user;
    } else if (body?.id && Array.isArray(body?.identities)) {
      this.user = body;
    }

    // Always fetch the authoritative Auth user after an unlink. This catches
    // provider removal/revocation and lets ProfileClient reconcile an avatar
    // that came from the identity that just disappeared.
    await this.sync({ reason: 'identity-unlink' });
    return this.snapshot();
  }

  async _refreshSession() {
    if (!this.session?.refreshToken) {
      throw new Error('Session sans refresh token.');
    }

    const response = await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        ...this._authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: this.session.refreshToken }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.msg || body?.message || body?.error_description || `Refresh HTTP ${response.status}`);
    }

    const data = await response.json();
    this.session = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.session.refreshToken,
      tokenType: data.token_type || 'bearer',
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };

    if (data.user) {
      this.user = data.user;
    }

    this._save();
    return this.session.accessToken;
  }

  async _validAccessToken() {
    if (!this.session) {
      return null;
    }

    if (this.session.expiresAt > Date.now() + SESSION_SKEW_MS) {
      return this.session.accessToken;
    }

    return this._refreshSession();
  }

  async _fetchUser(accessToken) {
    const response = await fetch(`${this.url}/auth/v1/user`, {
      headers: this._authHeaders(accessToken),
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Session invalide (HTTP ${response.status}).`);
    }

    return response.json();
  }



  async accessToken() {
    return this._validAccessToken();
  }

  async sync({ reason = 'manual' } = {}) {
    if (!this.session) {
      this._setStatus('signed_out');
      return this.snapshot();
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this._setStatus('offline');
      return this.snapshot();
    }

    this._setStatus('loading');

    try {
      const accessToken = await this._validAccessToken();
      const user = await this._fetchUser(accessToken);
      this.user = user;
      const result = await this.profileClient.fetch(accessToken, user);
      this.profile = result.profile;
      this.error = result.error;
      this._save();
      this._setStatus('signed_in', this.error);
      return this.snapshot();
    } catch (error) {
      // A 401 / invalid refresh means the session is no longer usable.
      if (/401|invalid|refresh token/i.test(String(error?.message || error))) {
        this._clearLocal();
        this._setStatus('signed_out');
      } else {
        this._setStatus(reason === 'startup' && this.profile ? 'offline' : 'error', error);
      }
      return this.snapshot();
    }
  }

  async updateProfilePreferences(preferences) {
    if (!this.user?.id || !this.session) {
      throw new Error('Connecte-toi avant de modifier le profil.');
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Une connexion Internet est nécessaire pour modifier le profil.');
    }

    const accessToken = await this._validAccessToken();
    this.profile = await this.profileClient.updatePreferences(accessToken, this.user, preferences);
    this.error = null;
    this._save();
    this._emit();
    return this.snapshot();
  }

  async signOut() {
    const accessToken = this.session?.accessToken;

    if (accessToken && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        await fetch(`${this.url}/auth/v1/logout`, {
          method: 'POST',
          headers: this._authHeaders(accessToken),
        });
      } catch {
        // Local sign-out still proceeds if the network call fails.
      }
    }

    this._clearLocal();
    this._setStatus('signed_out');
  }
}

export { AUTH_LINK_INTENT_KEY, AUTH_STORAGE_KEY, identitiesFromUser, profileFromUser };
