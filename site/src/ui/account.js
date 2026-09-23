const PROVIDER_LABELS = Object.freeze({
  discord: 'Discord',
  google: 'Google',
});

const SUPPORTED_PROVIDER_ORDER = Object.freeze(['discord', 'google']);

function providerLabel(provider) {
  const key = String(provider || '').trim().toLowerCase();
  return PROVIDER_LABELS[key] || (key ? key[0].toUpperCase() + key.slice(1) : 'Compte');
}

function accountDisplayName(state) {
  return state.profile?.display_name
    || state.profile?.username
    || state.user?.user_metadata?.name
    || 'Joueur';
}

function accountUsername(state) {
  const value = state.profile?.username
    || state.user?.user_metadata?.user_name
    || state.user?.user_metadata?.preferred_username;
  return value ? `@${value}` : '';
}

function accountAvatar(state) {
  return state.profile?.avatar_url
    || state.user?.user_metadata?.avatar_url
    || state.user?.user_metadata?.picture
    || '';
}

function normalizedIdentityMap(identities = []) {
  const map = new Map();
  for (const identity of identities) {
    const provider = String(identity?.provider || '').trim().toLowerCase();
    if (!provider || map.has(provider)) continue;
    map.set(provider, identity);
  }
  return map;
}

function linkedProviderCount(identities = []) {
  const map = normalizedIdentityMap(identities);
  return SUPPORTED_PROVIDER_ORDER.filter(provider => map.has(provider)).length;
}

function renderLinkedIdentities(container, identities = [], {
  online = true,
  disabled = false,
  onLinkProvider = null,
} = {}) {
  if (!container) return;

  const byProvider = normalizedIdentityMap(identities);
  const providerOrder = [
    ...SUPPORTED_PROVIDER_ORDER,
    ...[...byProvider.keys()].filter(provider => !SUPPORTED_PROVIDER_ORDER.includes(provider)),
  ];

  container.replaceChildren();
  for (const providerName of providerOrder) {
    const identity = byProvider.get(providerName) || null;
    const row = document.createElement('div');
    row.className = `linked-identity-row ${identity ? 'is-linked' : 'is-unlinked'}`;
    row.dataset.provider = providerName;

    const provider = document.createElement('span');
    provider.className = 'linked-identity-provider';
    provider.textContent = providerLabel(providerName).toUpperCase();

    if (identity) {
      const status = document.createElement('strong');
      status.className = 'linked-identity-status';
      status.textContent = 'LIÉ';
      row.append(provider, status);
    } else if (SUPPORTED_PROVIDER_ORDER.includes(providerName)) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'identity-link-action';
      action.dataset.linkProvider = providerName;
      action.textContent = 'LIER';
      action.disabled = disabled || !online || typeof onLinkProvider !== 'function';
      action.setAttribute('aria-label', `Lier ${providerLabel(providerName)} au profil`);
      action.addEventListener('click', async () => {
        if (action.disabled) return;
        action.disabled = true;
        action.textContent = 'LIAISON…';
        try {
          await onLinkProvider(providerName);
        } catch {
          if (action.isConnected) {
            action.disabled = disabled || !online;
            action.textContent = 'LIER';
          }
        }
      });
      row.append(provider, action);
    } else {
      row.append(provider);
    }

    container.append(row);
  }
}

export class AccountUI {
  constructor({ auth, getBest, getScoreSyncState, getElement, onLinkProvider } = {}) {
    this.auth = auth;
    this.getBest = getBest;
    this.getScoreSyncState = getScoreSyncState;
    this.$ = getElement || (id => document.getElementById(id));
    this.onLinkProvider = onLinkProvider;

    this.$('account-avatar')?.addEventListener('error', () => {
      this.$('account-avatar').hidden = true;
      this.$('account-avatar-fallback').hidden = false;
    });
  }

  render(state = this.auth.snapshot()) {
    const scoreSync = this.getScoreSyncState?.() || { state: 'local', error: null };
    const signed = Boolean(state.user || state.profile)
      && ['signed_in', 'offline', 'loading'].includes(state.status);
    const online = typeof navigator === 'undefined' || navigator.onLine;
    const discordLogin = this.$('discord-login');
    const googleLogin = this.$('google-login');
    const logout = this.$('discord-logout');
    const linkedSection = this.$('account-linked-identities');
    const linkedList = this.$('linked-identities-list');

    if (this.$('account-signed-out')) {
      this.$('account-signed-out').hidden = signed;
    }
    if (this.$('account-signed-in')) {
      this.$('account-signed-in').hidden = !signed;
    }
    for (const login of [discordLogin, googleLogin]) {
      if (!login) continue;
      login.hidden = signed;
      login.disabled = !state.configured || !online || state.status === 'loading';
    }
    if (logout) {
      logout.hidden = !signed;
      logout.disabled = state.status === 'loading';
    }
    if (linkedSection) {
      linkedSection.hidden = !signed;
    }
    if (linkedList) {
      renderLinkedIdentities(linkedList, signed ? state.identities || [] : [], {
        online,
        disabled: state.status === 'loading',
        onLinkProvider: this.onLinkProvider,
      });
    }
    if (this.$('profile-best-score')) {
      this.$('profile-best-score').textContent = String(this.getBest());
    }

    const connectionStatus = this.$('connection-status');
    if (connectionStatus) {
      connectionStatus.textContent = !state.configured
        ? 'Connexion communautaire non configurée sur cette build.'
        : signed
          ? state.status === 'offline'
            ? 'Profil disponible hors connexion.'
            : (() => {
                const count = linkedProviderCount(state.identities || []);
                return `${count || 1} moyen${count > 1 ? 's' : ''} de connexion lié${count > 1 ? 's' : ''} au profil.`;
              })()
          : online
            ? 'Méthodes disponibles : Discord et Google.'
            : 'Hors connexion · la connexion au profil sera disponible au retour du réseau.';
    }

    const accountStatus = this.$('account-status');
    if (!accountStatus) {
      return;
    }

    if (!signed) {
      accountStatus.textContent = !state.configured
        ? 'Profil cloud indisponible sur cette build · le record local reste utilisable.'
        : state.status === 'error'
          ? 'Profil cloud indisponible pour le moment · le jeu reste jouable localement.'
          : online
            ? `Profil local · record ${this.getBest()}.`
            : `Hors connexion · profil local et record ${this.getBest()} disponibles.`;
      return;
    }

    this.$('account-name').textContent = accountDisplayName(state);
    this.$('account-username').textContent = accountUsername(state);

    const avatar = accountAvatar(state);
    const image = this.$('account-avatar');
    const fallback = this.$('account-avatar-fallback');
    if (avatar) {
      image.src = avatar;
      image.hidden = false;
      fallback.hidden = true;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      fallback.hidden = false;
      fallback.textContent = accountDisplayName(state).slice(0, 1).toUpperCase() || '?';
    }

    const best = this.getBest();
    accountStatus.textContent = state.status === 'offline' || scoreSync.state === 'offline'
      ? `Profil disponible hors connexion · record local ${best}, synchronisation au retour du réseau.`
      : state.status === 'loading' || scoreSync.state === 'syncing'
        ? 'Synchronisation du profil et du record…'
        : scoreSync.state === 'synced'
          ? `Profil synchronisé · record : ${best}.`
          : scoreSync.state === 'error'
            ? `Record local ${best} · synchronisation à réessayer.`
            : state.error
              ? `Record local ${best} · profil à resynchroniser.`
              : 'Profil synchronisé.';
  }
}

export { accountAvatar, accountDisplayName, accountUsername, linkedProviderCount, providerLabel, renderLinkedIdentities, SUPPORTED_PROVIDER_ORDER };
