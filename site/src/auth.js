import { parseLeaderboardRows, LEADERBOARD_MAX_ROWS } from './leaderboard.js';
import {
  createVerifiedRunSubmission,
  parseRunTicket,
  parseVerifiedRunResult,
} from './verified-runs.js';

const AUTH_STORAGE_KEY = 'flappy13-auth-v1';
const SESSION_SKEW_MS = 60 * 1000;

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function profileFromUser(user) {
  const meta = user?.user_metadata || {};
  const username =
    meta.user_name ||
    meta.preferred_username ||
    meta.name ||
    user?.email?.split('@')[0] ||
    'player';
  const displayName =
    meta.full_name ||
    meta.global_name ||
    meta.name ||
    meta.user_name ||
    username;
  const avatarUrl = meta.avatar_url || meta.picture || null;

  return {
    id: user?.id || null,
    username,
    display_name: displayName,
    avatar_url: avatarUrl,
    best_score: 0,
  };
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
    this.listeners = new Set();
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
      error: this.error,
      callbackResult: this.callbackResult,
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
    try {
      this.storage?.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // Best effort.
    }
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
    const error = params.get('error_description') || params.get('error');

    if (error) {
      this.callbackResult = 'error';
      this.error = error;
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
    this.callbackResult = 'signed_in';
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

  signInWithDiscord() {
    if (!this.configured) {
      throw new Error('Authentification non configurée.');
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Une connexion Internet est nécessaire pour se connecter.');
    }

    const authorize = new URL(`${this.url}/auth/v1/authorize`);
    authorize.searchParams.set('provider', 'discord');
    authorize.searchParams.set('redirect_to', this._redirectUrl());
    authorize.searchParams.set('scopes', 'identify email');
    location.assign(authorize.href);
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

  async _fetchProfile(accessToken, user) {
    const endpoint = new URL(`${this.url}/rest/v1/profiles`);
    endpoint.searchParams.set('id', `eq.${user.id}`);
    endpoint.searchParams.set('select', 'id,username,display_name,avatar_url,best_score,created_at,updated_at');

    const response = await fetch(endpoint, {
      headers: this._authHeaders(accessToken),
      cache: 'no-store',
    });

    if (!response.ok) {
      this.error = `Profil Supabase indisponible (HTTP ${response.status}).`;
      return profileFromUser(user);
    }

    const rows = await response.json();
    if (rows[0]) {
      this.error = null;
      return rows[0];
    }

    return this._insertProfile(accessToken, user);
  }

  async _insertProfile(accessToken, user) {
    const fallback = profileFromUser(user);
    const response = await fetch(`${this.url}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        ...this._authHeaders(accessToken),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(fallback),
    });

    if (!response.ok) {
      // Authentication is valid even if the optional profile table has not yet
      // been provisioned. Use Discord metadata locally and surface the DB issue.
      this.error = `Profil Supabase non initialisé (HTTP ${response.status}).`;
      return fallback;
    }

    const rows = await response.json();
    this.error = null;
    return rows[0] || fallback;
  }

  async syncBestScore(candidateScore) {
    if (!this.session) {
      throw new Error('Connexion requise pour synchroniser le record.');
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Synchronisation du record indisponible hors connexion.');
    }

    const candidate = Number(candidateScore);
    if (!Number.isInteger(candidate) || candidate < 0 || candidate > 2147483647) {
      throw new Error('Record local invalide.');
    }

    const accessToken = await this._validAccessToken();
    const response = await fetch(`${this.url}/rest/v1/rpc/sync_best_score`, {
      method: 'POST',
      headers: {
        ...this._authHeaders(accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ candidate_score: candidate }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        body?.message || body?.hint || body?.details || `Synchronisation du record HTTP ${response.status}`,
      );
    }

    const payload = await response.json();
    const remoteBest = Number(
      typeof payload === 'number'
        ? payload
        : Array.isArray(payload)
          ? payload[0]
          : payload?.best_score ?? payload?.sync_best_score,
    );

    if (!Number.isInteger(remoteBest) || remoteBest < 0 || remoteBest > 2147483647) {
      throw new Error('Réponse de synchronisation du record invalide.');
    }

    if (this.profile) {
      this.profile.best_score = remoteBest;
    } else if (this.user) {
      this.profile = { ...profileFromUser(this.user), best_score: remoteBest };
    }

    this._save();
    this._emit();
    return remoteBest;
  }

  async fetchLeaderboard({ limit = LEADERBOARD_MAX_ROWS } = {}) {
    if (!this.configured) {
      throw new Error('Leaderboard unavailable: Supabase is not configured.');
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const error = new Error('Leaderboard unavailable offline.');
      error.code = 'offline';
      throw error;
    }

    const normalizedLimit = Math.max(
      1,
      Math.min(Number(limit) || LEADERBOARD_MAX_ROWS, LEADERBOARD_MAX_ROWS),
    );
    const response = await fetch(`${this.url}/rest/v1/rpc/get_leaderboard`, {
      method: 'POST',
      headers: {
        ...this._authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit_count: normalizedLimit }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error(
        body?.message || body?.hint || body?.details || `Leaderboard HTTP ${response.status}`,
      );
      error.status = response.status;
      throw error;
    }

    return parseLeaderboardRows(await response.json(), { maxRows: normalizedLimit });
  }

  async startVerifiedRun() {
    if (!this.session) {
      throw new Error('Connexion requise pour démarrer une partie classée.');
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Une connexion Internet est nécessaire au démarrage d’une partie classée.');
    }

    const accessToken = await this._validAccessToken();
    const response = await fetch(`${this.url}/functions/v1/run-start`, {
      method: 'POST',
      headers: {
        ...this._authHeaders(accessToken),
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        payload?.message || payload?.error || `Création du run classé HTTP ${response.status}`,
      );
    }

    return parseRunTicket(payload);
  }

  async submitVerifiedRun(submission) {
    if (!this.session) {
      throw new Error('Connexion requise pour soumettre une partie classée.');
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const error = new Error('Soumission du run indisponible hors connexion.');
      error.code = 'offline';
      error.retryable = true;
      throw error;
    }

    let normalized;
    try {
      normalized = createVerifiedRunSubmission(submission);
    } catch (cause) {
      const error = new Error(cause?.message || 'Soumission locale invalide.');
      error.status = 400;
      error.code = 'invalid_submission';
      error.retryable = false;
      throw error;
    }
    const accessToken = await this._validAccessToken();
    const response = await fetch(`${this.url}/functions/v1/run-submit`, {
      method: 'POST',
      headers: {
        ...this._authHeaders(accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(normalized),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(
        payload?.message || payload?.error || `Soumission du run HTTP ${response.status}`,
      );
      error.status = response.status;
      error.code = payload?.error || null;
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }

    return parseVerifiedRunResult(payload);
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
      this.profile = await this._fetchProfile(accessToken, user);
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

export { AUTH_STORAGE_KEY, profileFromUser };
