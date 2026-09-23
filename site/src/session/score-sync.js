export class ScoreSyncController {
  constructor({ auth, client, getBest, applyBest, onStateChange } = {}) {
    this.auth = auth;
    this.client = client;
    this.getBest = getBest;
    this.applyBest = applyBest;
    this.onStateChange = onStateChange;
    this.state = 'local';
    this.error = null;
    this.promise = null;
    this.dirty = false;
  }

  available(state = this.auth.snapshot()) {
    return Boolean(state.user || state.profile)
      && state.status === 'signed_in'
      && (typeof navigator === 'undefined' || navigator.onLine);
  }

  snapshot() {
    return { state: this.state, error: this.error };
  }

  setOffline(hasSession = Boolean(this.auth.session)) {
    this.state = hasSession ? 'offline' : 'local';
    this.error = null;
    this.#notify();
  }

  reset() {
    this.state = 'local';
    this.error = null;
    this.dirty = false;
    this.#notify();
  }

  async sync({ reason = 'manual', notify = false } = {}) {
    void reason;
    void notify;
    const authState = this.auth.snapshot();

    if (!this.available(authState)) {
      this.state = authState.status === 'offline'
        || (typeof navigator !== 'undefined' && !navigator.onLine)
        ? 'offline'
        : 'local';
      this.error = null;
      this.#notify(authState);
      return this.getBest();
    }

    if (this.promise) {
      this.dirty = true;
      return this.promise;
    }

    this.state = 'syncing';
    this.error = null;
    this.#notify(authState);

    this.promise = (async () => {
      try {
        let merged = this.getBest();
        do {
          this.dirty = false;
          merged = await this.client.sync(this.getBest());
          this.applyBest(merged);
          if (this.getBest() > merged) {
            this.dirty = true;
          }
        } while (this.dirty);

        this.state = 'synced';
        this.error = null;
        this.#notify(this.auth.snapshot());
        return this.getBest();
      } catch (error) {
        this.state = typeof navigator !== 'undefined' && navigator.onLine ? 'error' : 'offline';
        this.error = String(error?.message || error);
        this.#notify(this.auth.snapshot());
        return this.getBest();
      } finally {
        this.promise = null;
      }
    })();

    return this.promise;
  }

  #notify(authState = this.auth.snapshot()) {
    this.onStateChange?.({ ...this.snapshot(), authState });
  }
}
