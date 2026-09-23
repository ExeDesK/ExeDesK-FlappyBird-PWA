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

    this.$('account-signed-out').hidden = signed;
    this.$('account-signed-in').hidden = !signed;
    this.$('discord-login').disabled = !state.configured
      || (typeof navigator !== 'undefined' && !navigator.onLine)
      || state.status === 'loading';
    this.$('discord-logout').disabled = state.status === 'loading';

    if (!signed) {
      this.$('account-status').textContent = !state.configured
        ? 'Connexion communautaire non configurée sur cette build.'
        : state.status === 'error'
          ? 'Connexion indisponible pour le moment. Le jeu reste jouable localement.'
          : typeof navigator === 'undefined' || navigator.onLine
            ? 'Compte facultatif · connectez-vous pour retrouver votre profil sur tous vos appareils.'
            : 'Hors connexion · la connexion Discord sera disponible au retour du réseau.';
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
    this.$('account-status').textContent = state.status === 'offline' || scoreSync.state === 'offline'
      ? `Profil disponible hors connexion · record local ${best}, synchronisation au retour du réseau.`
      : state.status === 'loading' || scoreSync.state === 'syncing'
        ? 'Synchronisation du profil et du record…'
        : scoreSync.state === 'synced'
          ? `Connecté à Discord · record synchronisé : ${best}.`
          : scoreSync.state === 'error'
            ? `Connecté à Discord · record local ${best} · synchronisation à réessayer.`
            : state.error
              ? `Connecté à Discord · record local ${best} · profil à resynchroniser.`
              : 'Connecté avec Discord · profil synchronisé.';
  }
}

export { accountAvatar, accountDisplayName, accountUsername };
