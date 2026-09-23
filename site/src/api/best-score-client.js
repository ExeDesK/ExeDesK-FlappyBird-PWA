import { normalizeSupabaseConfig, responseError, supabaseHeaders } from './http.js';

export class BestScoreClient {
  constructor({ url, publishableKey, getAccessToken } = {}) {
    const config = normalizeSupabaseConfig({ url, publishableKey });
    this.url = config.url;
    this.publishableKey = config.publishableKey;
    this.getAccessToken = getAccessToken;
  }

  get configured() {
    return Boolean(this.url && this.publishableKey);
  }

  async sync(candidateScore) {
    if (typeof this.getAccessToken !== 'function') {
      throw new Error('Connexion requise pour synchroniser le record.');
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Synchronisation du record indisponible hors connexion.');
    }

    const candidate = Number(candidateScore);
    if (!Number.isInteger(candidate) || candidate < 0 || candidate > 2147483647) {
      throw new Error('Record local invalide.');
    }

    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      throw new Error('Connexion requise pour synchroniser le record.');
    }

    const response = await fetch(`${this.url}/rest/v1/rpc/sync_best_score`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(this.publishableKey, accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ candidate_score: candidate }),
    });

    if (!response.ok) {
      throw await responseError(response, `Synchronisation du record HTTP ${response.status}`);
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

    return remoteBest;
  }
}
