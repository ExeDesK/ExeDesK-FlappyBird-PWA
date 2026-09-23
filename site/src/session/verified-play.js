import {
  VerifiedRunRecorder,
  enqueueVerifiedRun,
  isPlayRelease,
  pendingVerifiedRuns as readPendingVerifiedRuns,
  pendingVerifiedRunsForPlayer,
  removePendingVerifiedRun,
  shouldDiscardVerifiedRunSubmission,
  verifiedRunStartMode,
} from '../verified-run-client.js';

export class VerifiedPlayController {
  constructor({
    auth,
    api,
    leaderboard,
    toast,
    getElement,
    warningDialog,
    clearInput,
    resetClock,
    playSwoosh,
    syncUtilityVisibility,
    prepareVisualThemeForRun,
    activatePendingVisualTheme,
    cancelPendingVisualTheme,
    installVerifiedGame,
    isCurrentGame,
    saveBest,
    playFadeSeconds = 0.5,
  } = {}) {
    this.auth = auth;
    this.api = api;
    this.leaderboard = leaderboard;
    this.toast = toast;
    this.$ = getElement || (id => document.getElementById(id));
    this.warningDialog = warningDialog;
    this.clearInput = clearInput;
    this.resetClock = resetClock;
    this.playSwoosh = playSwoosh;
    this.syncUtilityVisibility = syncUtilityVisibility;
    this.prepareVisualThemeForRun = prepareVisualThemeForRun;
    this.activatePendingVisualTheme = activatePendingVisualTheme;
    this.cancelPendingVisualTheme = cancelPendingVisualTheme;
    this.installVerifiedGame = installVerifiedGame;
    this.isCurrentGame = isCurrentGame || (() => true);
    this.saveBest = saveBest;
    this.playFadeSeconds = playFadeSeconds;
    this.playFadeMinMs = playFadeSeconds * 1000;

    this.startPending = false;
    this.allowUnrankedPlayOnce = false;
    this.recorder = null;
    this.lastRun = null;
    this.warningResolver = null;
    this.flushPromise = null;

    this.#bindWarningDialog();
  }

  get recording() {
    return this.recorder;
  }

  snapshot() {
    return this.recorder?.snapshot() ?? structuredClone(this.lastRun);
  }

  pendingRuns() {
    try {
      return readPendingVerifiedRuns();
    } catch {
      return [];
    }
  }

  abandon() {
    if (this.recorder && !this.recorder.finished) {
      this.lastRun = {
        status: 'abandoned',
        ...this.recorder.snapshot(),
      };
    }
    this.recorder = null;
  }

  beforeTick(game, input) {
    this.recorder?.beforeTick(game, input);
  }

  afterTick(game) {
    const submission = this.recorder?.afterTick(game);
    if (submission) this.queueSubmission(submission);
    return submission;
  }

  interceptPlay(game, input) {
    if (!isPlayRelease(game, input)) return false;

    if (!this.allowUnrankedPlayOnce) {
      this.prepareVisualThemeForRun?.();
    }

    if (this.allowUnrankedPlayOnce) {
      this.allowUnrankedPlayOnce = false;
      return false;
    }

    const mode = verifiedRunStartMode({
      hasSession: Boolean(this.auth.session),
      online: navigator.onLine,
    });

    if (mode === 'local') {
      this.recorder = null;
      return false;
    }

    game.play.pressed = false;
    game.play.released = false;
    const fadeStartedAt = mode === 'ticket' ? this.#startFade(game) : null;
    void this.#beginAuthenticatedPlay(game, mode, fadeStartedAt);
    return true;
  }

  queueSubmission(submission) {
    try {
      const playerId = this.auth.user?.id || this.auth.profile?.id || null;
      const pending = enqueueVerifiedRun(submission, { playerId });
      this.lastRun = {
        status: 'queued',
        run_id: submission.run_id,
        terminal_tick: submission.terminal_tick,
        tap_count: submission.taps.length,
        pending,
      };
      console.info('[Verified Runs] Replay enregistré pour soumission.', this.lastRun);

      if (navigator.onLine && this.auth.session) {
        void this.flush({ reason: 'run-finished', notify: true });
      } else {
        this.toast?.('Pas d’internet · envoi reporté. Le run reste conservé sur cet appareil.', 6000);
      }
    } catch (error) {
      this.lastRun = {
        status: 'queue-error',
        run_id: submission.run_id,
        error: String(error?.message || error),
      };
      console.error('[Verified Runs] Enregistrement local impossible.', error);
      this.toast?.('Impossible d’enregistrer ce run classé sur cet appareil.', 6000);
    }
  }

  async flush({ reason = 'manual', notify = false } = {}) {
    if (this.flushPromise) return this.flushPromise;

    const playerId = this.auth.user?.id || this.auth.profile?.id;
    if (!this.auth.session || !playerId || !navigator.onLine) {
      return { verified: 0, rejected: 0, discarded: 0, deferred: true };
    }

    this.flushPromise = (async () => {
      let verified = 0;
      let rejected = 0;
      let discarded = 0;
      let deferred = false;
      let highestVerifiedScore = -1;
      let lastResult = null;
      const queue = pendingVerifiedRunsForPlayer(playerId);

      for (const item of queue) {
        const submission = item?.submission;
        if (!submission?.run_id) continue;

        try {
          const result = await this.api.submit(submission);
          removePendingVerifiedRun(submission.run_id);
          lastResult = result;

          if (result.status === 'verified') {
            verified++;
            highestVerifiedScore = Math.max(highestVerifiedScore, result.score);
          } else {
            rejected++;
          }
        } catch (error) {
          if (shouldDiscardVerifiedRunSubmission(error)) {
            removePendingVerifiedRun(submission.run_id);
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

      if (highestVerifiedScore >= 0) {
        this.saveBest?.(highestVerifiedScore);
        this.leaderboard?.invalidateVerifiedData();
        if (this.leaderboard?.dialog?.open && navigator.onLine) {
          void this.leaderboard.refreshAll({ force: true });
        }
      }

      if (lastResult) {
        this.lastRun = {
          status: lastResult.status,
          run_id: lastResult.run_id,
          score: lastResult.score,
          collision: lastResult.collision,
          rejection_code: lastResult.rejection_code,
          resolved_at: lastResult.resolved_at,
          idempotent: lastResult.idempotent,
        };
      }

      console.info('[Verified Runs] File de soumission traitée.', {
        reason,
        verified,
        rejected,
        discarded,
        deferred,
      });

      if (notify) {
        if (rejected > 0) {
          this.toast?.(
            rejected === 1
              ? 'Run rejeté par la vérification serveur.'
              : `${rejected} runs rejetés par la vérification serveur.`,
            6000,
          );
        } else if (discarded > 0) {
          this.toast?.('Une ancienne soumission incompatible a été retirée.', 6000);
        } else if (deferred) {
          this.toast?.('Pas d’internet · envoi reporté. Le run reste conservé sur cet appareil.', 6000);
        }
      }

      return { verified, rejected, discarded, deferred };
    })().finally(() => {
      this.flushPromise = null;
    });

    return this.flushPromise;
  }

  #bindWarningDialog() {
    if (!this.warningDialog) return;

    this.$('unranked-continue').onclick = () => this.#settleWarning(true);
    this.$('unranked-cancel').onclick = () => this.#settleWarning(false);
    this.warningDialog.addEventListener('cancel', event => {
      event.preventDefault();
      this.#settleWarning(false);
    });
  }

  #settleWarning(continueLocally) {
    const resolve = this.warningResolver;
    this.warningResolver = null;
    if (this.warningDialog?.open) this.warningDialog.close();
    resolve?.(continueLocally);
  }

  #askToPlayUnranked(message) {
    if (this.warningResolver) this.#settleWarning(false);

    this.$('unranked-warning-message').textContent = message;
    this.clearInput?.();
    this.resetClock?.();

    return new Promise(resolve => {
      this.warningResolver = resolve;
      this.warningDialog.showModal();
      this.$('unranked-continue').focus();
    });
  }

  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async #waitForFadeToBlack(originGame, startedAt) {
    while (
      this.isCurrentGame(originGame)
      && (
        performance.now() - startedAt < this.playFadeMinMs
        || !originGame.fade.done
        || originGame.fade.value < 1
      )
    ) {
      await this.#sleep(16);
    }
    return this.isCurrentGame(originGame);
  }

  async #ensureFadeToBlack(originGame, startedAt = null) {
    let effectiveStartedAt = startedAt;

    while (this.isCurrentGame(originGame) && effectiveStartedAt == null) {
      if (originGame.fade.done) {
        effectiveStartedAt = this.#startFade(originGame);
        break;
      }
      await this.#sleep(16);
    }

    if (!this.isCurrentGame(originGame) || effectiveStartedAt == null) return false;
    return this.#waitForFadeToBlack(originGame, effectiveStartedAt);
  }

  #startFade(originGame) {
    if (!originGame?.fade?.done) return null;

    const startedAt = performance.now();
    originGame.transition(true, 0, this.playFadeSeconds);
    this.playSwoosh?.();
    this.syncUtilityVisibility?.();
    this.resetClock?.();
    return startedAt;
  }

  #restoreMenuFromBlack(originGame) {
    if (!this.isCurrentGame(originGame)) return;
    if (originGame.fade.done && originGame.fade.value > 0) {
      originGame.transition(false, 0, this.playFadeSeconds);
    }
    this.syncUtilityVisibility?.();
    this.resetClock?.();
  }

  #startUnrankedFromBlack(originGame) {
    if (!this.isCurrentGame(originGame)) return;
    this.recorder = null;
    this.activatePendingVisualTheme?.();
    originGame.event(5);
    this.syncUtilityVisibility?.();
    this.resetClock?.();
  }

  async #beginAuthenticatedPlay(originGame, mode, fadeStartedAt = null) {
    if (this.startPending) return;
    this.startPending = true;

    try {
      if (mode === 'warn-offline') {
        const proceed = await this.#askToPlayUnranked(
          'Vous êtes connecté à Discord, mais l’application est hors ligne. '
          + 'Cette partie ne pourra pas être comptabilisée dans le classement.',
        );

        if (proceed && this.isCurrentGame(originGame) && originGame.play.active) {
          this.recorder = null;
          this.allowUnrankedPlayOnce = true;
          originGame.play.pressed = true;
        } else {
          this.cancelPendingVisualTheme?.();
        }
        return;
      }

      const fadePromise = this.#ensureFadeToBlack(originGame, fadeStartedAt);

      try {
        const ticketPromise = this.api.start();
        const [ticket, stillCurrent] = await Promise.all([ticketPromise, fadePromise]);

        if (stillCurrent && this.isCurrentGame(originGame) && originGame.play.active) {
          const installed = this.installVerifiedGame?.(ticket) || {};
          this.recorder = new VerifiedRunRecorder(ticket);
          this.lastRun = {
            status: 'ready',
            run_id: ticket.run_id,
            physics_version: ticket.physics_version,
            warmup_frames: installed.warmupFrames ?? null,
          };
          console.info('[Verified Runs] Partie classée prête.', this.lastRun);
        }
      } catch (error) {
        console.warn('[Verified Runs] Ticket indisponible.', error);
        await fadePromise;

        const proceed = await this.#askToPlayUnranked(
          `Impossible de préparer la partie classée : ${error?.message || error}. `
          + 'Vous pouvez continuer, mais cette partie ne sera pas comptabilisée.',
        );

        if (proceed && this.isCurrentGame(originGame) && originGame.play.active) {
          this.#startUnrankedFromBlack(originGame);
        } else {
          this.cancelPendingVisualTheme?.();
          this.#restoreMenuFromBlack(originGame);
        }
      }
    } finally {
      this.startPending = false;
      this.resetClock?.();
    }
  }
}
