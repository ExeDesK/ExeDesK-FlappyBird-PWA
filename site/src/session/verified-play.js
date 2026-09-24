import { VerifiedRunRecorder } from '../replay/verified-run-recorder.js';
import { GameTransitionController } from '../ui/game-transition.js';
import { UnrankedWarningDialog } from '../ui/unranked-warning.js';
import { isPlayRelease, verifiedRunStartMode } from '../verified-run-client.js';
import { VerifiedRunAbandoner } from './verified-run-abandon.js';
import { VerifiedRunQueue } from './verified-run-queue.js';
import { VerifiedRunSubmitter } from './verified-run-submit.js';

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
    getVisualContextForRun,
    installVerifiedGame,
    isCurrentGame,
    saveBest,
    playFadeSeconds = 0.5,
    queue,
    submitter,
    transition,
    warning,
    abandoner,
  } = {}) {
    this.auth = auth;
    this.api = api;
    this.leaderboard = leaderboard;
    this.toast = toast;
    this.resetClock = resetClock;
    this.syncUtilityVisibility = syncUtilityVisibility;
    this.prepareVisualThemeForRun = prepareVisualThemeForRun;
    this.activatePendingVisualTheme = activatePendingVisualTheme;
    this.cancelPendingVisualTheme = cancelPendingVisualTheme;
    this.getVisualContextForRun = getVisualContextForRun;
    this.installVerifiedGame = installVerifiedGame;
    this.isCurrentGame = isCurrentGame || (() => true);
    this.saveBest = saveBest;

    this.queue = queue || new VerifiedRunQueue();
    this.submitter = submitter || new VerifiedRunSubmitter({ api, queue: this.queue });
    this.transition = transition || new GameTransitionController({
      durationSeconds: playFadeSeconds,
      isCurrentGame: this.isCurrentGame,
      playSwoosh,
      syncUtilityVisibility,
      resetClock,
    });
    this.abandoner = abandoner || new VerifiedRunAbandoner({ auth, api });
    this.warning = warning || new UnrankedWarningDialog({
      dialog: warningDialog,
      getElement,
      clearInput,
      resetClock,
    });

    this.startPending = false;
    this.allowUnrankedPlayOnce = false;
    this.recorder = null;
    this.lastRun = null;
    this.flushPromise = null;
  }

  get recording() {
    return this.recorder;
  }

  snapshot() {
    return this.recorder?.snapshot() ?? structuredClone(this.lastRun);
  }

  pendingRuns() {
    try {
      return this.queue.all();
    } catch {
      return [];
    }
  }

  abandon(options = {}) {
    const abandoned = this.abandoner.abandon(this.recorder, options);
    if (abandoned.lastRun) this.lastRun = abandoned.lastRun;
    this.recorder = null;
    return abandoned.completion;
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
    const fadeStartedAt = mode === 'ticket'
      ? this.transition.startToBlack(game)
      : null;
    void this.#beginAuthenticatedPlay(game, mode, fadeStartedAt);
    return true;
  }

  queueSubmission(submission) {
    try {
      const playerId = this.auth.user?.id || this.auth.profile?.id || null;
      const pending = this.queue.enqueue(submission, { playerId });
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

    this.flushPromise = this.submitter
      .flushForPlayer(playerId, { reason })
      .then(result => {
        this.#applyFlushResult(result, notify);
        return {
          verified: result.verified,
          rejected: result.rejected,
          discarded: result.discarded,
          deferred: result.deferred,
        };
      })
      .finally(() => {
        this.flushPromise = null;
      });

    return this.flushPromise;
  }

  #applyFlushResult(result, notify) {
    if (result.highestVerifiedScore >= 0) {
      this.saveBest?.(result.highestVerifiedScore);
      this.leaderboard?.invalidateVerifiedData();
      if (this.leaderboard?.dialog?.open && navigator.onLine) {
        void this.leaderboard.refreshAll({ force: true });
      }
    }

    if (result.lastResult) {
      this.lastRun = {
        status: result.lastResult.status,
        run_id: result.lastResult.run_id,
        score: result.lastResult.score,
        collision: result.lastResult.collision,
        rejection_code: result.lastResult.rejection_code,
        resolved_at: result.lastResult.resolved_at,
        idempotent: result.lastResult.idempotent,
      };
    }

    console.info('[Verified Runs] File de soumission traitée.', result);

    if (!notify) return;
    if (result.rejected > 0) {
      this.toast?.(
        result.rejected === 1
          ? 'Run rejeté par la vérification serveur.'
          : `${result.rejected} runs rejetés par la vérification serveur.`,
        6000,
      );
    } else if (result.discarded > 0) {
      this.toast?.('Une ancienne soumission incompatible a été retirée.', 6000);
    } else if (result.deferred) {
      this.toast?.('Pas d’internet · envoi reporté. Le run reste conservé sur cet appareil.', 6000);
    }
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
        const proceed = await this.warning.ask(
          'Vous êtes connecté, mais l’application est hors ligne. '
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

      const fadePromise = this.transition.ensureBlack(originGame, fadeStartedAt);

      try {
        const ticketPromise = this.api.start();
        const [ticket, stillCurrent] = await Promise.all([ticketPromise, fadePromise]);

        if (stillCurrent && this.isCurrentGame(originGame) && originGame.play.active) {
          const installed = this.installVerifiedGame?.(ticket) || {};
          this.recorder = new VerifiedRunRecorder(ticket, {
            visualContext: this.getVisualContextForRun?.() ?? null,
          });
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

        const proceed = await this.warning.ask(
          `Impossible de préparer la partie classée : ${error?.message || error}. `
          + 'Vous pouvez continuer, mais cette partie ne sera pas comptabilisée.',
        );

        if (proceed && this.isCurrentGame(originGame) && originGame.play.active) {
          this.#startUnrankedFromBlack(originGame);
        } else {
          this.cancelPendingVisualTheme?.();
          this.transition.restoreFromBlack(originGame);
        }
      }
    } finally {
      this.startPending = false;
      this.resetClock?.();
    }
  }
}
