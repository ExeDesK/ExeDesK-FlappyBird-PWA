const DEFAULT_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_PROBE_TIMEOUT_MS = 3500;

export class PwaUpdateManager {
  constructor({
    version,
    lastVersionKey = 'flappy13-last-version-v1',
    getElement,
    toast,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  } = {}) {
    this.version = version;
    this.lastVersionKey = lastVersionKey;
    this.$ = getElement || (id => document.getElementById(id));
    this.toast = toast;
    this.checkIntervalMs = checkIntervalMs;
    this.probeTimeoutMs = probeTimeoutMs;

    this.cacheInfo = null;
    this.remoteVersion = null;
    this.pendingUpdateVersion = null;
    this.registration = null;
    this.checkTimer = null;
    this.checking = false;
    this.reloadOnControllerChange = false;
  }

  async checkOffline() {
    const controller = navigator.serviceWorker?.controller;
    if (!controller) return false;

    const status = await new Promise(resolve => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => resolve(null), 5000);
      channel.port1.onmessage = event => {
        clearTimeout(timeout);
        channel.port1.close();
        resolve(event.data);
      };
      controller.postMessage({ type: 'VERIFY_CACHE' }, [channel.port2]);
    });

    this.cacheInfo = status;
    if (status?.complete) {
      this.$('offline-status').textContent = 'Disponible hors connexion.';
      return true;
    }

    this.$('offline-status').textContent =
      'Le mode hors connexion se prépare encore. Gardez la connexion quelques instants.';
    return false;
  }

  updateButton({ text, disabled }) {
    const button = this.$('refresh-cache');
    button.textContent = text;
    button.disabled = disabled;
  }

  rememberVersion() {
    let previous = null;
    try {
      previous = localStorage.getItem(this.lastVersionKey);
      localStorage.setItem(this.lastVersionKey, this.version);
    } catch {
      // Version notices are cosmetic only.
    }
    return previous && previous !== this.version ? previous : null;
  }

  async publishedVersion() {
    if (!navigator.onLine) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.probeTimeoutMs);
    const versionUrl = new URL('./version.json', location.href);
    versionUrl.searchParams.set('_check', String(Date.now()));

    try {
      const response = await fetch(versionUrl, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const body = await response.json();
      return typeof body?.version === 'string' ? body.version : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async workerBuild(worker) {
    if (!worker) return null;

    return new Promise(resolve => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => {
        channel.port1.close();
        resolve(null);
      }, 1500);
      channel.port1.onmessage = event => {
        clearTimeout(timeout);
        channel.port1.close();
        resolve(typeof event.data?.build === 'string' ? event.data.build : null);
      };
      try {
        worker.postMessage({ type: 'GET_BUILD' }, [channel.port2]);
      } catch {
        clearTimeout(timeout);
        channel.port1.close();
        resolve(null);
      }
    });
  }

  async markUpdateReady(version = null) {
    const waiting = this.registration?.waiting;
    if (!waiting) return false;

    this.pendingUpdateVersion = version
      || await this.workerBuild(waiting)
      || this.remoteVersion
      || 'nouvelle version';

    this.$('update-status').textContent =
      `Mise à jour ${this.pendingUpdateVersion} prête · installation automatique au prochain lancement.`;
    this.updateButton({ text: 'Installer maintenant', disabled: false });
    return true;
  }

  watchInstallingWorker(worker) {
    if (!worker) return;

    const onStateChange = async () => {
      if (worker.state === 'installed' && this.registration?.waiting) {
        worker.removeEventListener('statechange', onStateChange);
        await this.markUpdateReady(this.remoteVersion);
      } else if (worker.state === 'redundant') {
        worker.removeEventListener('statechange', onStateChange);
        this.$('update-status').textContent =
          'La mise à jour n’a pas pu être préparée. Une nouvelle tentative sera faite automatiquement.';
        this.updateButton({
          text: 'Rechercher une mise à jour',
          disabled: !navigator.onLine,
        });
      }
    };

    worker.addEventListener('statechange', onStateChange);
  }

  async checkForUpdates({ silent = false, reason = 'manual' } = {}) {
    if (!isSecureContext || !('serviceWorker' in navigator)) {
      this.$('update-status').textContent =
        'Mises à jour automatiques indisponibles dans ce navigateur.';
      this.updateButton({ text: 'Rechercher une mise à jour', disabled: true });
      return 'unsupported';
    }

    if (!this.registration) return 'not-ready';
    if (this.registration.waiting) {
      await this.markUpdateReady();
      return 'ready';
    }
    if (this.checking) return 'checking';

    this.checking = true;
    this.updateButton({ text: 'Recherche en cours…', disabled: true });

    try {
      const version = await this.publishedVersion();
      this.remoteVersion = version;

      if (!version) {
        this.$('update-status').textContent = navigator.onLine
          ? 'Vérification impossible pour le moment. Nouvelle tentative automatique plus tard.'
          : 'Hors connexion · les mises à jour reprendront automatiquement.';
        this.updateButton({
          text: 'Rechercher une mise à jour',
          disabled: !navigator.onLine,
        });
        if (!silent && navigator.onLine) {
          this.toast?.('Impossible de vérifier les mises à jour pour le moment.');
        }
        return 'unreachable';
      }

      if (version === this.version) {
        this.pendingUpdateVersion = null;
        this.$('update-status').textContent = `À jour · version ${this.version}`;
        this.updateButton({ text: 'Rechercher une mise à jour', disabled: false });
        return 'current';
      }

      this.$('update-status').textContent =
        `Nouvelle version ${version} détectée · préparation en arrière-plan…`;

      try {
        await this.registration.update();
      } catch {
        this.$('update-status').textContent =
          `Version ${version} détectée, mais son téléchargement sera retenté automatiquement.`;
        this.updateButton({ text: 'Rechercher une mise à jour', disabled: false });
        return 'detected';
      }

      if (this.registration.waiting) {
        await this.markUpdateReady(version);
        return 'ready';
      }
      if (this.registration.installing) {
        this.watchInstallingWorker(this.registration.installing);
        return 'installing';
      }

      this.$('update-status').textContent =
        `Version ${version} détectée · préparation automatique en cours.`;
      this.updateButton({ text: 'Rechercher une mise à jour', disabled: false });
      return 'detected';
    } finally {
      this.checking = false;
    }
  }

  stopUpdateChecks() {
    clearInterval(this.checkTimer);
    this.checkTimer = null;
  }

  startUpdateChecks() {
    this.stopUpdateChecks();
    this.checkTimer = setInterval(() => {
      if (!document.hidden && navigator.onLine) {
        void this.checkForUpdates({ silent: true, reason: 'timer' });
      }
    }, this.checkIntervalMs);
  }

  async installPendingUpdate({ automatic = false } = {}) {
    const waiting = this.registration?.waiting;
    if (!waiting) {
      if (!automatic) {
        await this.checkForUpdates({ silent: false, reason: 'manual' });
      }
      return false;
    }

    this.reloadOnControllerChange = true;
    this.$('update-status').textContent = 'Installation de la mise à jour…';
    this.updateButton({ text: 'Installation…', disabled: true });

    try {
      waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
      return true;
    } catch (error) {
      this.reloadOnControllerChange = false;
      this.$('update-status').textContent =
        'La mise à jour reste prête et sera retentée au prochain lancement.';
      this.updateButton({ text: 'Installer maintenant', disabled: false });
      if (!automatic) this.toast?.(`Installation reportée : ${error.message}`);
      return false;
    }
  }

  async action() {
    if (this.registration?.waiting) {
      await this.installPendingUpdate();
      return;
    }
    await this.checkForUpdates({ silent: false, reason: 'manual' });
  }

  noteOffline() {
    this.$('update-status').textContent =
      'Hors connexion · les mises à jour reprendront automatiquement.';
    this.updateButton({ text: 'Rechercher une mise à jour', disabled: true });
  }

  async setup() {
    if (!isSecureContext || !('serviceWorker' in navigator)) {
      this.$('offline-status').textContent =
        'Le mode hors connexion n’est disponible qu’en HTTPS ou sur localhost.';
      this.$('update-status').textContent =
        'Mises à jour automatiques indisponibles ici.';
      this.updateButton({ text: 'Rechercher une mise à jour', disabled: true });
      return;
    }

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (this.reloadOnControllerChange) {
        this.reloadOnControllerChange = false;
        location.reload();
        return;
      }
      void this.checkOffline();
    });

    this.registration = await navigator.serviceWorker.register(
      new URL('../../sw.js', import.meta.url),
      { updateViaCache: 'none' },
    );
    this.registration.addEventListener('updatefound', () => {
      this.watchInstallingWorker(this.registration.installing);
    });
    await navigator.serviceWorker.ready;

    const waitingAtLaunch = this.registration.waiting;
    if (waitingAtLaunch) {
      const waitingBuild = await this.workerBuild(waitingAtLaunch);
      if (!waitingBuild || waitingBuild !== this.version) {
        await this.markUpdateReady(waitingBuild);
        await this.installPendingUpdate({ automatic: true });
        return;
      }
    }

    this.rememberVersion();
    await this.checkOffline();
    await this.checkForUpdates({ silent: true, reason: 'startup' });
    this.startUpdateChecks();
  }
}

export { DEFAULT_CHECK_INTERVAL_MS, DEFAULT_PROBE_TIMEOUT_MS };
