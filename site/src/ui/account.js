import { PROFILE_DISPLAY_NAME_MAX } from '../api/profile-client.js';
import { availableAvatarProviders, resolvedAvatarProvider } from '../auth/provider-profile.js';
import { applyGeneratedAvatarFallback } from './avatar-fallback.js';

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

function renderIdentityActionButton(text, className, ariaLabel, disabled, onClick) {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = className;
  action.textContent = text;
  action.disabled = disabled;
  action.setAttribute('aria-label', ariaLabel);
  action.addEventListener('click', event => {
    event.preventDefault();
    if (!action.disabled) onClick?.(action);
  });
  return action;
}

function renderLinkedIdentities(container, identities = [], {
  online = true,
  disabled = false,
  unlinkCandidate = null,
  busyProvider = null,
  onLinkProvider = null,
  onRequestUnlink = null,
  onConfirmUnlink = null,
  onCancelUnlink = null,
} = {}) {
  if (!container) return;

  const byProvider = normalizedIdentityMap(identities);
  const linkedCount = linkedProviderCount(identities);
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
      const actions = document.createElement('span');
      actions.className = 'linked-identity-actions';

      const status = document.createElement('strong');
      status.className = 'linked-identity-status';
      status.textContent = 'LIÉ';
      actions.append(status);

      if (SUPPORTED_PROVIDER_ORDER.includes(providerName)) {
        const isBusy = busyProvider === providerName;
        const canUnlink = linkedCount > 1 && Boolean(identity.identity_id) && online;

        if (unlinkCandidate === providerName && canUnlink) {
          const confirm = renderIdentityActionButton(
            isBusy ? 'DÉLIAISON…' : 'CONFIRMER',
            'identity-unlink-confirm',
            `Confirmer la déliaison de ${providerLabel(providerName)}`,
            disabled || isBusy,
            () => onConfirmUnlink?.(providerName, identity.identity_id),
          );
          const cancel = renderIdentityActionButton(
            'ANNULER',
            'identity-unlink-cancel',
            `Annuler la déliaison de ${providerLabel(providerName)}`,
            disabled || isBusy,
            () => onCancelUnlink?.(),
          );
          actions.append(confirm, cancel);
        } else if (linkedCount > 1 && identity.identity_id) {
          const unlink = renderIdentityActionButton(
            'DÉLIER',
            'identity-unlink-action',
            `Délier ${providerLabel(providerName)} du profil`,
            disabled || !online || Boolean(busyProvider),
            () => onRequestUnlink?.(providerName),
          );
          actions.append(unlink);
        } else {
          const protectedStatus = document.createElement('small');
          protectedStatus.className = 'linked-identity-protected';
          protectedStatus.textContent = linkedCount <= 1 ? 'DERNIER ACCÈS' : 'SYNCHRO REQUISE';
          actions.append(protectedStatus);
        }
      }

      row.append(provider, actions);
    } else if (SUPPORTED_PROVIDER_ORDER.includes(providerName)) {
      const action = renderIdentityActionButton(
        'LIER',
        'identity-link-action',
        `Lier ${providerLabel(providerName)} au profil`,
        disabled || !online || Boolean(busyProvider) || typeof onLinkProvider !== 'function',
        async button => {
          button.disabled = true;
          button.textContent = 'LIAISON…';
          try {
            await onLinkProvider(providerName);
          } catch {
            if (button.isConnected) {
              button.disabled = disabled || !online;
              button.textContent = 'LIER';
            }
          }
        },
      );
      row.append(provider, action);
    } else {
      row.append(provider);
    }

    container.append(row);
  }
}

function renderAvatarChoices(container, state, preferredProvider = null) {
  if (!container) return null;

  const choices = availableAvatarProviders(state.user);
  const selected = preferredProvider
    || resolvedAvatarProvider(state.user, state.profile)
    || choices[0]?.provider
    || null;

  container.replaceChildren();
  if (!choices.length) {
    const preview = document.createElement('div');
    preview.className = 'profile-avatar-generated-preview';

    const avatar = document.createElement('span');
    avatar.className = 'profile-avatar-generated';
    applyGeneratedAvatarFallback(avatar, accountDisplayName(state));

    const text = document.createElement('span');
    text.className = 'profile-avatar-generated-copy';
    const title = document.createElement('strong');
    title.textContent = 'AVATAR GÉNÉRÉ';
    const hint = document.createElement('small');
    hint.textContent = 'Aucune photo fournie par Discord ou Google.';
    text.append(title, hint);
    preview.append(avatar, text);
    container.append(preview);
    return null;
  }

  for (const choice of choices) {
    const label = document.createElement('label');
    label.className = 'profile-avatar-option';
    label.dataset.provider = choice.provider;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'profile-avatar-provider';
    radio.value = choice.provider;
    radio.checked = choice.provider === selected;

    const content = document.createElement('span');
    content.className = 'profile-avatar-option-content';

    const image = document.createElement('img');
    image.src = choice.avatar_url;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';

    const name = document.createElement('strong');
    name.textContent = providerLabel(choice.provider).toUpperCase();

    content.append(image, name);
    label.append(radio, content);
    container.append(label);
  }

  return selected;
}

export class AccountUI {
  constructor({
    auth,
    getBest,
    getScoreSyncState,
    getElement,
    onLinkProvider,
    onUnlinkProvider,
    onProfileUpdated,
  } = {}) {
    this.auth = auth;
    this.getBest = getBest;
    this.getScoreSyncState = getScoreSyncState;
    this.$ = getElement || (id => document.getElementById(id));
    this.onLinkProvider = onLinkProvider;
    this.onUnlinkProvider = onUnlinkProvider;
    this.onProfileUpdated = onProfileUpdated;
    this.customizationDirty = false;
    this.avatarSignature = null;
    this.unlinkCandidate = null;
    this.busyProvider = null;
    this.identityNotice = null;

    this.$('account-avatar')?.addEventListener('error', () => {
      this.$('account-avatar').hidden = true;
      this.$('account-avatar-fallback').hidden = false;
      applyGeneratedAvatarFallback(this.$('account-avatar-fallback'), accountDisplayName(this.auth.snapshot()));
    });

    this.$('profile-display-name')?.addEventListener('input', () => {
      this.customizationDirty = true;
      this.updateNameCounter();
    });
    this.$('profile-avatar-choices')?.addEventListener('change', () => {
      this.customizationDirty = true;
    });
    this.$('profile-customization-form')?.addEventListener('submit', event => {
      event.preventDefault();
      void this.saveCustomization();
    });
  }

  updateNameCounter() {
    const input = this.$('profile-display-name');
    const counter = this.$('profile-display-name-count');
    if (input && counter) {
      counter.textContent = `${input.value.length}/${PROFILE_DISPLAY_NAME_MAX}`;
    }
  }

  renderCustomization(state, { signed, online }) {
    const section = this.$('profile-customization-form');
    if (!section) return;
    section.hidden = !signed;
    if (!signed) return;

    const input = this.$('profile-display-name');
    const choices = this.$('profile-avatar-choices');
    const save = this.$('profile-customization-save');
    const status = this.$('profile-customization-status');
    const available = availableAvatarProviders(state.user);
    const preferred = choices?.querySelector('input[name="profile-avatar-provider"]:checked')?.value || null;
    const signature = JSON.stringify({
      selected: state.profile?.avatar_provider || null,
      choices: available.map(item => [item.provider, item.avatar_url]),
      generated: available.length ? null : accountDisplayName(state),
    });

    if (input && !this.customizationDirty) {
      input.value = accountDisplayName(state);
      this.updateNameCounter();
    }

    if (choices && signature !== this.avatarSignature) {
      renderAvatarChoices(choices, state, preferred);
      this.avatarSignature = signature;
    }

    if (input) input.disabled = !online || state.status === 'loading';
    if (save) save.disabled = !online || state.status === 'loading';
    for (const radio of choices?.querySelectorAll('input[type="radio"]') || []) {
      radio.disabled = !online || state.status === 'loading';
    }

    if (status && !this.customizationDirty) {
      status.textContent = online
        ? 'Ton pseudo et ta photo sont visibles dans le classement.'
        : 'Reconnecte-toi pour modifier le pseudo ou la photo de profil.';
    }
  }

  async saveCustomization() {
    const input = this.$('profile-display-name');
    const save = this.$('profile-customization-save');
    const status = this.$('profile-customization-status');
    const checked = this.$('profile-avatar-choices')
      ?.querySelector('input[name="profile-avatar-provider"]:checked');

    if (!input || !save) return;
    save.disabled = true;
    if (status) status.textContent = 'ENREGISTREMENT…';

    try {
      const state = await this.auth.updateProfilePreferences({
        displayName: input.value,
        avatarProvider: checked?.value || null,
      });
      this.customizationDirty = false;
      this.avatarSignature = null;
      await this.onProfileUpdated?.(state);
      this.render(state);
      if (status) status.textContent = 'Profil mis à jour partout.';
    } catch (error) {
      if (status) status.textContent = String(error?.message || error || 'Mise à jour impossible.');
      save.disabled = false;
    }
  }

  requestUnlink(provider) {
    this.unlinkCandidate = provider;
    this.identityNotice = `Délier ${providerLabel(provider)} ? Tu ne pourras plus utiliser ce fournisseur pour te connecter à ce profil. Ton pseudo, ton record et ton historique seront conservés.`;
    this.render();
  }

  cancelUnlink() {
    this.unlinkCandidate = null;
    this.identityNotice = null;
    this.render();
  }

  async confirmUnlink(provider, identityId) {
    if (this.busyProvider) return;
    this.busyProvider = provider;
    this.identityNotice = `Déliaison de ${providerLabel(provider)}…`;
    this.render();

    try {
      const state = await this.onUnlinkProvider?.(provider, identityId);
      this.unlinkCandidate = null;
      this.avatarSignature = null;
      const remaining = (state?.identities || [])
        .map(identity => String(identity?.provider || '').toLowerCase())
        .filter(name => SUPPORTED_PROVIDER_ORDER.includes(name));
      const remainingLabel = remaining.map(providerLabel).join(' et ');
      this.identityNotice = `${providerLabel(provider)} a été délié. ${remainingLabel || 'Le moyen de connexion restant'} conserve l’accès au même profil.`;
      this.render(state || this.auth.snapshot());
    } catch (error) {
      this.identityNotice = String(error?.message || error || 'Déliaison impossible.');
      this.render();
    } finally {
      this.busyProvider = null;
      this.render();
    }
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
    const linkedCount = linkedProviderCount(state.identities || []);

    if (this.unlinkCandidate && !(state.identities || []).some(identity => identity?.provider === this.unlinkCandidate)) {
      this.unlinkCandidate = null;
    }

    if (this.$('account-signed-out')) this.$('account-signed-out').hidden = signed;
    if (this.$('account-signed-in')) this.$('account-signed-in').hidden = !signed;
    for (const login of [discordLogin, googleLogin]) {
      if (!login) continue;
      login.hidden = signed;
      login.disabled = !state.configured || !online || state.status === 'loading';
    }
    if (logout) {
      logout.hidden = !signed;
      logout.disabled = state.status === 'loading' || Boolean(this.busyProvider);
    }
    if (linkedSection) linkedSection.hidden = !signed;
    if (linkedList) {
      renderLinkedIdentities(linkedList, signed ? state.identities || [] : [], {
        online,
        disabled: state.status === 'loading',
        unlinkCandidate: this.unlinkCandidate,
        busyProvider: this.busyProvider,
        onLinkProvider: this.onLinkProvider,
        onRequestUnlink: provider => this.requestUnlink(provider),
        onConfirmUnlink: (provider, identityId) => void this.confirmUnlink(provider, identityId),
        onCancelUnlink: () => this.cancelUnlink(),
      });
    }

    const identityStatus = this.$('identity-management-status');
    if (identityStatus) {
      identityStatus.textContent = this.identityNotice
        || (!online
          ? 'La gestion des connexions nécessite Internet.'
          : linkedCount <= 1
            ? 'Ajoute un second moyen de connexion avant de pouvoir délier celui-ci.'
            : 'Délier un fournisseur ne supprime ni le profil, ni le record, ni l’historique.');
    }

    this.renderCustomization(state, { signed, online });
    if (this.$('profile-best-score')) this.$('profile-best-score').textContent = String(this.getBest());

    const connectionStatus = this.$('connection-status');
    if (connectionStatus) {
      connectionStatus.textContent = !state.configured
        ? 'Connexion communautaire non configurée sur cette build.'
        : signed
          ? state.status === 'offline'
            ? 'Profil disponible hors connexion.'
            : `${linkedCount || 1} moyen${linkedCount > 1 ? 's' : ''} de connexion lié${linkedCount > 1 ? 's' : ''} au profil.`
          : online
            ? 'Méthodes disponibles : Discord et Google.'
            : 'Hors connexion · la connexion au profil sera disponible au retour du réseau.';
    }

    const accountStatus = this.$('account-status');
    if (!accountStatus) return;

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
      applyGeneratedAvatarFallback(fallback, accountDisplayName(state));
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

export {
  accountAvatar,
  accountDisplayName,
  accountUsername,
  linkedProviderCount,
  providerLabel,
  renderAvatarChoices,
  renderLinkedIdentities,
  SUPPORTED_PROVIDER_ORDER
};
