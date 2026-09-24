import {
  LEADERBOARD_MAX_ROWS,
  parseLeaderboardContext,
  parseLeaderboardReplay,
  parseLeaderboardRows,
  parsePlayerPerformanceStats,
} from '../leaderboard.js';
import { normalizeSupabaseConfig, responseError, supabaseHeaders } from './http.js';

export class LeaderboardClient {
  constructor({ url, publishableKey, getAccessToken } = {}) {
    const config = normalizeSupabaseConfig({ url, publishableKey });
    this.url = config.url;
    this.publishableKey = config.publishableKey;
    this.getAccessToken = getAccessToken;
  }

  get configured() {
    return Boolean(this.url && this.publishableKey);
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
        ...supabaseHeaders(this.publishableKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit_count: normalizedLimit }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const error = await responseError(response, `Leaderboard HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return parseLeaderboardRows(await response.json(), { maxRows: normalizedLimit });
  }

  async fetchReplay(runId) {
    if (!this.configured) {
      throw new Error('Replay unavailable: Supabase is not configured.');
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const error = new Error('Replay indisponible hors connexion.');
      error.code = 'offline';
      throw error;
    }

    const response = await fetch(`${this.url}/rest/v1/rpc/get_leaderboard_replay`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(this.publishableKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target_run_id: runId }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const error = await responseError(response, `Replay HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return parseLeaderboardReplay(await response.json());
  }

  async fetchMyLeaderboardContext() {
    if (!this.configured) {
      throw new Error('Connexion requise pour charger votre classement.');
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const error = new Error('Classement personnel indisponible hors connexion.');
      error.code = 'offline';
      throw error;
    }

    const accessToken = await this.#requiredAccessToken('Connexion requise pour charger votre classement.');
    const response = await fetch(`${this.url}/rest/v1/rpc/get_my_leaderboard_context`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(this.publishableKey, accessToken),
        'Content-Type': 'application/json',
      },
      body: '{}',
      cache: 'no-store',
    });

    if (!response.ok) {
      const error = await responseError(response, `Classement personnel HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return parseLeaderboardContext(await response.json());
  }

  async fetchMyPlayerPerformanceStats() {
    if (!this.configured) {
      throw new Error('Connexion requise pour charger vos statistiques.');
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const error = new Error('Statistiques indisponibles hors connexion.');
      error.code = 'offline';
      throw error;
    }

    const accessToken = await this.#requiredAccessToken('Connexion requise pour charger vos statistiques.');
    const response = await fetch(`${this.url}/rest/v1/rpc/get_my_player_performance_stats`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(this.publishableKey, accessToken),
        'Content-Type': 'application/json',
      },
      body: '{}',
      cache: 'no-store',
    });

    if (!response.ok) {
      const error = await responseError(response, `Statistiques HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return parsePlayerPerformanceStats(await response.json());
  }

  async #requiredAccessToken(message) {
    if (!this.configured || typeof this.getAccessToken !== 'function') {
      throw new Error(message);
    }
    const token = await this.getAccessToken();
    if (!token) {
      throw new Error(message);
    }
    return token;
  }
}
