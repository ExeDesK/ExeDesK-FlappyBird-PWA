export class GameTransitionController {
  constructor({
    durationSeconds = 0.5,
    isCurrentGame = () => true,
    playSwoosh,
    syncUtilityVisibility,
    resetClock,
    now = () => performance.now(),
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  } = {}) {
    this.durationSeconds = durationSeconds;
    this.minDurationMs = durationSeconds * 1000;
    this.isCurrentGame = isCurrentGame;
    this.playSwoosh = playSwoosh;
    this.syncUtilityVisibility = syncUtilityVisibility;
    this.resetClock = resetClock;
    this.now = now;
    this.sleep = sleep;
  }

  startToBlack(originGame) {
    if (!originGame?.fade?.done) return null;

    const startedAt = this.now();
    originGame.transition(true, 0, this.durationSeconds);
    this.playSwoosh?.();
    this.syncUtilityVisibility?.();
    this.resetClock?.();
    return startedAt;
  }

  async waitUntilBlack(originGame, startedAt) {
    while (
      this.isCurrentGame(originGame)
      && (
        this.now() - startedAt < this.minDurationMs
        || !originGame.fade.done
        || originGame.fade.value < 1
      )
    ) {
      await this.sleep(16);
    }

    return this.isCurrentGame(originGame);
  }

  async ensureBlack(originGame, startedAt = null) {
    let effectiveStartedAt = startedAt;

    while (this.isCurrentGame(originGame) && effectiveStartedAt == null) {
      if (originGame.fade.done) {
        effectiveStartedAt = this.startToBlack(originGame);
        break;
      }
      await this.sleep(16);
    }

    if (!this.isCurrentGame(originGame) || effectiveStartedAt == null) return false;
    return this.waitUntilBlack(originGame, effectiveStartedAt);
  }

  restoreFromBlack(originGame) {
    if (!this.isCurrentGame(originGame)) return false;

    if (originGame.fade.done && originGame.fade.value > 0) {
      originGame.transition(false, 0, this.durationSeconds);
    }
    this.syncUtilityVisibility?.();
    this.resetClock?.();
    return true;
  }
}
