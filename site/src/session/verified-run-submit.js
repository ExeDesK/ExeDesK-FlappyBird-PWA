export function verifiedRunDeferredNotice(error = {}, { online = true, hasSession = true } = {}) {
  if (!online || error.code === 'offline') {
    return {
      message: 'Pas d’internet · envoi reporté. Le run reste conservé sur cet appareil.',
      duration: 6000,
    };
  }
  if (!hasSession || error.status === 401 || error.status === 403) {
    return { message: 'Session indisponible · run conservé. Reconnectez-vous pour l’envoyer.', duration: 7000 };
  }
  if (error.status === 429) {
    const retry = error.retryAfter ? ` Réessayez dans ${error.retryAfter} s.` : '';
    return { message: `Serveur temporairement limité · run conservé.${retry}`, duration: 7000 };
  }
  const suffix = error.status ? ` (HTTP ${error.status})` : '';
  return {
    message: `Serveur de vérification indisponible${suffix} · run conservé et envoi reporté.`,
    duration: 7000,
  };
}

export function shouldDiscardVerifiedRunSubmission(error) {
  if ([400, 409, 413, 422].includes(error?.status)) {
    return true;
  }

  return error?.status === 404 && error?.code === 'run_not_found';
}

export class VerifiedRunSubmitter {
  constructor({ api, queue } = {}) {
    this.api = api;
    this.queue = queue;
  }

  async flushForPlayer(playerId, { reason = 'manual' } = {}) {
    let verified = 0;
    let rejected = 0;
    let discarded = 0;
    let deferred = false;
    let highestVerifiedScore = -1;
    let lastResult = null;
    let deferredError = null;

    for (const item of this.queue.forPlayer(playerId)) {
      const submission = item?.submission;
      if (!submission?.run_id) continue;

      try {
        const result = await this.api.submit(submission);
        this.queue.remove(submission.run_id);
        lastResult = result;

        if (result.status === 'verified') {
          verified++;
          highestVerifiedScore = Math.max(highestVerifiedScore, result.score);
        } else {
          rejected++;
        }
      } catch (error) {
        if (shouldDiscardVerifiedRunSubmission(error)) {
          this.queue.remove(submission.run_id);
          discarded++;
          console.warn('[Verified Runs] Soumission locale abandonnée.', {
            run_id: submission.run_id,
            status: error?.status,
            code: error?.code,
          });
          continue;
        }

        deferred = true;
        deferredError = {
          status: Number(error?.status) || null,
          code: error?.code || null,
          message: error?.message || null,
          retryAfter: Number(error?.retryAfter) || null,
        };
        console.warn('[Verified Runs] Soumission différée.', {
          run_id: submission.run_id,
          reason,
          status: error?.status,
          code: error?.code,
          message: error?.message,
        });
        break;
      }
    }

    return {
      verified,
      rejected,
      discarded,
      deferred,
      highestVerifiedScore,
      lastResult,
      deferredError,
    };
  }
}
