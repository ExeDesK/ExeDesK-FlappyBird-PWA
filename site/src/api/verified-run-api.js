import {
  createVerifiedRunSubmission,
  parseRunId,
  parseRunTicket,
  parseVerifiedRunResult,
} from '../verified-runs.js';
import { normalizeSupabaseConfig, supabaseHeaders } from './http.js';

export class VerifiedRunClient {
  constructor({ url, publishableKey, getAccessToken } = {}) {
    const config = normalizeSupabaseConfig({ url, publishableKey });
    this.url = config.url;
    this.publishableKey = config.publishableKey;
    this.getAccessToken = getAccessToken;
  }

  async start() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Une connexion Internet est nécessaire au démarrage d’une partie classée.');
    }

    const accessToken = await this.#requiredAccessToken('Connexion requise pour démarrer une partie classée.');
    const response = await fetch(`${this.url}/functions/v1/run-start`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(this.publishableKey, accessToken),
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(
        payload?.message || payload?.error || `Création du run classé HTTP ${response.status}`,
      );
      error.status = response.status;
      error.code = payload?.error || null;
      error.retryAfter = Number(
        payload?.retry_after_seconds || response.headers.get('Retry-After') || 0,
      ) || null;
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }

    return parseRunTicket(payload);
  }


  async cancel(runId) {
    const normalizedRunId = parseRunId(runId);

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const error = new Error('Annulation du ticket indisponible hors connexion.');
      error.code = 'offline';
      error.retryable = true;
      throw error;
    }

    const accessToken = await this.#requiredAccessToken('Connexion requise pour annuler une partie classée.');
    const response = await fetch(`${this.url}/rest/v1/rpc/cancel_verified_run`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(this.publishableKey, accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target_run_id: normalizedRunId }),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(
        payload?.message || payload?.error || `Annulation du run HTTP ${response.status}`,
      );
      error.status = response.status;
      error.code = payload?.error || null;
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }

    return {
      run_id: normalizedRunId,
      cancelled: payload === true,
    };
  }

  async submit(submission) {
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

    const accessToken = await this.#requiredAccessToken('Connexion requise pour soumettre une partie classée.');
    const response = await fetch(`${this.url}/functions/v1/run-submit`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(this.publishableKey, accessToken),
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

  async #requiredAccessToken(message) {
    if (typeof this.getAccessToken !== 'function') {
      throw new Error(message);
    }
    const token = await this.getAccessToken();
    if (!token) {
      throw new Error(message);
    }
    return token;
  }
}
