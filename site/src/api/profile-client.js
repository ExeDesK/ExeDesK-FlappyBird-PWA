import { normalizeSupabaseConfig, responseError, supabaseHeaders } from './http.js';
import { providerAvatarUrl, resolvedAvatarProvider } from '../auth/provider-profile.js';

export const PROFILE_DISPLAY_NAME_MAX = 24;

export function normalizeDisplayName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function profileFromUser(user) {
  const meta = user?.user_metadata || {};
  const username =
    meta.user_name
    || meta.preferred_username
    || meta.name
    || user?.email?.split('@')[0]
    || 'player';
  const displayName =
    meta.full_name
    || meta.global_name
    || meta.name
    || meta.user_name
    || username;
  const avatarUrl = meta.avatar_url || meta.picture || null;

  const avatarProvider = resolvedAvatarProvider(user);
  return {
    id: user?.id || null,
    username,
    display_name: displayName,
    avatar_url: avatarUrl,
    ...(avatarProvider ? { avatar_provider: avatarProvider } : {}),
    best_score: 0,
  };
}

export class ProfileClient {
  constructor(config = {}) {
    const normalized = normalizeSupabaseConfig(config);
    this.url = normalized.url;
    this.publishableKey = normalized.publishableKey;
  }

  headers(accessToken, extra = {}) {
    return {
      ...supabaseHeaders(this.publishableKey, accessToken),
      ...extra,
    };
  }

  endpoint(userId) {
    const endpoint = new URL(`${this.url}/rest/v1/profiles`);
    endpoint.searchParams.set('id', `eq.${userId}`);
    endpoint.searchParams.set(
      'select',
      'id,username,display_name,avatar_url,avatar_provider,best_score,created_at,updated_at',
    );
    return endpoint;
  }

  async fetch(accessToken, user) {
    const response = await fetch(this.endpoint(user.id), {
      headers: this.headers(accessToken),
      cache: 'no-store',
    });

    if (!response.ok) {
      return {
        profile: profileFromUser(user),
        error: `Profil Supabase indisponible (HTTP ${response.status}).`,
      };
    }

    const rows = await response.json();
    const profile = rows[0]
      ? rows[0]
      : await this.insert(accessToken, user);

    if (!profile) {
      return {
        profile: profileFromUser(user),
        error: 'Profil Supabase non initialisé.',
      };
    }

    const refreshed = await this.refreshSelectedAvatar(accessToken, user, profile).catch(() => profile);
    return { profile: refreshed, error: null };
  }

  async insert(accessToken, user) {
    const fallback = profileFromUser(user);
    const response = await fetch(`${this.url}/rest/v1/profiles`, {
      method: 'POST',
      headers: this.headers(accessToken, {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      }),
      body: JSON.stringify(fallback),
    });

    if (!response.ok) return null;
    const rows = await response.json();
    return rows[0] || fallback;
  }

  async patch(accessToken, userId, changes) {
    const response = await fetch(this.endpoint(userId), {
      method: 'PATCH',
      headers: this.headers(accessToken, {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      }),
      body: JSON.stringify(changes),
    });

    if (!response.ok) {
      throw await responseError(response, `Mise à jour du profil impossible (HTTP ${response.status}).`);
    }

    const rows = await response.json();
    if (!rows[0]) {
      throw new Error('Profil introuvable après mise à jour.');
    }
    return rows[0];
  }

  async refreshSelectedAvatar(accessToken, user, profile) {
    if (!profile?.avatar_provider) return profile;

    const avatarProvider = resolvedAvatarProvider(user, profile);
    const avatarUrl = avatarProvider ? providerAvatarUrl(user, avatarProvider) : null;

    if (profile.avatar_provider === avatarProvider && profile.avatar_url === avatarUrl) {
      return profile;
    }

    return this.patch(accessToken, user.id, {
      avatar_provider: avatarProvider,
      avatar_url: avatarUrl,
    });
  }

  async updatePreferences(accessToken, user, { displayName, avatarProvider } = {}) {
    const normalizedName = normalizeDisplayName(displayName);
    if (!normalizedName) {
      throw new Error('Choisis un pseudo.');
    }
    if (normalizedName.length > PROFILE_DISPLAY_NAME_MAX) {
      throw new Error(`Le pseudo est limité à ${PROFILE_DISPLAY_NAME_MAX} caractères.`);
    }

    const changes = { display_name: normalizedName };
    const provider = String(avatarProvider || '').trim().toLowerCase();
    if (provider) {
      const avatarUrl = providerAvatarUrl(user, provider);
      if (!avatarUrl) {
        throw new Error('La photo de profil sélectionnée n’est pas disponible.');
      }
      changes.avatar_provider = provider;
      changes.avatar_url = avatarUrl;
    }

    return this.patch(accessToken, user.id, changes);
  }
}
