export class VerifiedRunAbandoner {
  constructor({ auth, api } = {}) {
    this.auth = auth;
    this.api = api;
  }

  abandon(recorder, { reason = 'navigation' } = {}) {
    if (!recorder || recorder.finished) {
      return {
        lastRun: null,
        completion: Promise.resolve({ cancelled: false, deferred: false }),
      };
    }

    const snapshot = recorder.snapshot();
    const lastRun = {
      status: 'abandoned',
      reason,
      ...snapshot,
    };

    return {
      lastRun,
      completion: this.#release(snapshot.run_id, reason),
    };
  }

  #release(runId, reason) {
    if (!runId
        || !this.auth?.session
        || !globalThis.navigator?.onLine
        || typeof this.api?.cancel !== 'function') {
      return Promise.resolve({ run_id: runId ?? null, cancelled: false, deferred: Boolean(runId) });
    }

    return this.api.cancel(runId)
      .then(result => {
        console.info('[Verified Runs] Ticket abandonné libéré.', {
          run_id: runId,
          reason,
          cancelled: Boolean(result.cancelled),
        });
        return result;
      })
      .catch(error => {
        console.warn('[Verified Runs] Annulation du ticket reportée au nettoyage serveur.', {
          run_id: runId,
          reason,
          error: String(error?.message || error),
        });
        return {
          run_id: runId,
          cancelled: false,
          deferred: true,
          error,
        };
      });
  }
}
