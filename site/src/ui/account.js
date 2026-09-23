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

export class AccountUI {
  constructor({ auth, getBest, getScoreSyncState, getElement } = {}) {
    this.auth = auth;
    this.getBest = getBest;
    this.getScoreSyncState = getScoreSyncState;
    this.$ = getElement || (id => document.getElementById(id));

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
    const login = this.$('discord-login');
    const logout = this.$('discord-logout');

    if (this.$('account-signed-out')) {
      this.$('account-signed-out').hidden = signed;
    }
    if (this.$('account-signed-in')) {
      this.$('account-signed-in').hidden = !signed;
    }
    if (login) {
      login.hidden = signed;
      login.disabled = !state.configured || !online || state.status === 'loading';
    }
    if (logout) {
      logout.hidden = !signed;
      logout.disabled = state.status === 'loading';
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
            ? 'Session Discord disponible hors connexion.'
            : 'Session Discord active.'
          : online
            ? 'Méthode disponible : Discord.'
            : 'Hors connexion · la connexion Discord sera disponible au retour du réseau.';
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

export { accountAvatar, accountDisplayName, accountUsername };
