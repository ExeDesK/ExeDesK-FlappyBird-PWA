import {
  createVerifiedRunSubmission,
  isVerifiedRunTerminal,
} from '../verified-runs.js';

function isEffectiveTap(game, tap) {
  if (!game || !tap || game.menu || game.bird.dead || game.bird.y < 0) {
    return false;
  }

  if (tap.x >= -20 && tap.x <= 46 && tap.y >= -20 && tap.y <= 48) {
    return false;
  }

  if (game.bird.idle) {
    return game.ready.active && game.ready.stage === 1;
  }

  return game.speed > 0;
}

export class VerifiedRunRecorder {
  constructor(ticket) {
    this.ticket = ticket;
    this.started = false;
    this.finished = false;
    this.tick = -1;
    this.taps = [];
    this.submission = null;
  }

  beforeTick(game, input = {}) {
    if (this.finished) {
      return;
    }

    const effectiveTap = isEffectiveTap(game, input.tap);

    if (!this.started) {
      if (!effectiveTap) {
        return;
      }

      this.started = true;
      this.tick = 0;
      this.taps.push(0);
      return;
    }

    this.tick++;
    if (effectiveTap) {
      this.taps.push(this.tick);
    }
  }

  afterTick(game) {
    if (!this.started || this.finished || !isVerifiedRunTerminal(game)) {
      return null;
    }

    this.submission = createVerifiedRunSubmission({
      run_id: this.ticket.run_id,
      physics_version: this.ticket.physics_version,
      terminal_tick: this.tick,
      taps: this.taps,
    });
    this.finished = true;
    return this.submission;
  }

  snapshot() {
    return {
      run_id: this.ticket.run_id,
      physics_version: this.ticket.physics_version,
      started: this.started,
      finished: this.finished,
      tick: this.tick,
      taps: [...this.taps],
      submission: this.submission ? structuredClone(this.submission) : null,
    };
  }
}
