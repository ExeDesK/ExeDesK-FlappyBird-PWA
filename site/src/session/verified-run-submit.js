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
    };
  }
}
