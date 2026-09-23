import { normalizeSupabaseConfig, responseError, supabaseHeaders } from '../api/http.js';

async function asAccessToken(getAccessToken, message) {
  if (typeof getAccessToken !== 'function') {
    throw new Error(message);
  }
  const token = await getAccessToken();
  if (!token) {
    throw new Error(message);
  }
  return token;
}

export class AnalyticsClient {
  constructor({ url, publishableKey, getAccessToken } = {}) {
    const config = normalizeSupabaseConfig({ url, publishableKey });
    this.url = config.url;
    this.publishableKey = config.publishableKey;
    this.getAccessToken = getAccessToken;
  }

  get configured() {
    return Boolean(this.url && this.publishableKey);
  }

  async #rpc(name, body = {}) {
    if (!this.configured) {
      throw new Error('Supabase non configuré.');
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const error = new Error('Le dashboard Analytics nécessite une connexion Internet.');
      error.code = 'offline';
      throw error;
    }

    const token = await asAccessToken(
      this.getAccessToken,
      'Connexion Discord requise pour accéder aux Analytics.',
    );
    const response = await fetch(`${this.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(this.publishableKey, token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (!response.ok) {
      const error = await responseError(response, `Analytics HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  async isAdmin() {
    const value = await this.#rpc('is_analytics_admin');
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return Boolean(value[0]);
    return Boolean(value);
  }

  async fetchOverview(days = 30) {
    const rows = await this.#rpc('admin_analytics_overview', {
      window_days: Number(days) || 30,
    });
    return Array.isArray(rows) ? (rows[0] || null) : rows;
  }

  async fetchDaily(days = 30) {
    const rows = await this.#rpc('admin_analytics_daily', {
      window_days: Number(days) || 30,
    });
    return Array.isArray(rows) ? rows : [];
  }

  async fetchPlayers({ limit = 100, offset = 0, search = '', sort = 'runs' } = {}) {
    const rows = await this.#rpc('admin_analytics_players', {
      limit_count: Number(limit) || 100,
      offset_count: Number(offset) || 0,
      search_query: String(search || ''),
      sort_key: String(sort || 'runs'),
    });
    return Array.isArray(rows) ? rows : [];
  }

  async fetchRetention(days = 90) {
    const rows = await this.#rpc('admin_analytics_retention', {
      cohort_days: Number(days) || 90,
    });
    return Array.isArray(rows) ? rows : [];
  }
}
