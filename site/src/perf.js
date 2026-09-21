export class PerfProfiler {
  constructor(windowMs = 10000) {
    this.windowMs = windowMs;
    this.active = false;
    this.startedAt = 0;
    this.lastRaf = null;
    this.samples = [];
    this.steps = [];
    this.renderTimes = [];
    this.tapTimes = [];
    this.audioTimes = [];
    this.pendingTapMarks = [];
    this.tapToRafTimes = [];
    this.tapFrameDeltas = [];
    this.result = null;
    this.frameDriver = 'raf';
  }

  start(now = performance.now(), frameDriver = 'raf') {
    this.active = true;
    this.startedAt = now;
    this.frameDriver = ['raf', 'timer', 'worker'].includes(frameDriver) ? frameDriver : 'raf';
    this.lastRaf = null;
    this.samples.length = 0;
    this.steps.length = 0;
    this.renderTimes.length = 0;
    this.tapTimes.length = 0;
    this.audioTimes.length = 0;
    this.pendingTapMarks.length = 0;
    this.tapToRafTimes.length = 0;
    this.tapFrameDeltas.length = 0;
    this.result = null;
  }

  tap(durationMs) {
    if (this.active && Number.isFinite(durationMs)) {
      this.tapTimes.push(durationMs);
    }
  }

  audio(durationMs) {
    if (this.active && Number.isFinite(durationMs)) {
      this.audioTimes.push(durationMs);
    }
  }

  markTap(now = performance.now()) {
    if (this.active && Number.isFinite(now)) {
      this.pendingTapMarks.push(now);
    }
  }

  frame(now, steps, renderMs) {
    if (!this.active) {
      return null;
    }

    let frameDelta = null;
    if (this.lastRaf !== null) {
      frameDelta = now - this.lastRaf;
      this.samples.push(frameDelta);
    }

    if (this.pendingTapMarks.length) {
      for (const tapAt of this.pendingTapMarks) {
        this.tapToRafTimes.push(now - tapAt);
        if (frameDelta !== null) {
          this.tapFrameDeltas.push(frameDelta);
        }
      }
      this.pendingTapMarks.length = 0;
    }

    this.lastRaf = now;
    this.steps.push(steps);
    this.renderTimes.push(renderMs);

    if (now - this.startedAt >= this.windowMs) {
      this.result = this.finish(now);
      return this.result;
    }

    return null;
  }

  finish(now = performance.now()) {
    if (!this.active && this.result) {
      return this.result;
    }

    this.active = false;

    const deltas = this.samples.slice().sort((a, b) => a - b);
    const renders = this.renderTimes.slice().sort((a, b) => a - b);
    const taps = this.tapTimes.slice().sort((a, b) => a - b);
    const audio = this.audioTimes.slice().sort((a, b) => a - b);
    const tapToRaf = this.tapToRafTimes.slice().sort((a, b) => a - b);
    const tapFrames = this.tapFrameDeltas.slice().sort((a, b) => a - b);
    const sum = values => values.reduce((total, value) => total + value, 0);
    const percentile = (values, ratio) => {
      if (!values.length) {
        return 0;
      }

      const index = Math.min(
        values.length - 1,
        Math.floor((values.length - 1) * ratio),
      );
      return values[index];
    };

    const totalMs = Math.max(1, now - this.startedAt);
    const frames = this.samples.length;

    const result = {
      durationMs: totalMs,
      frameDriver: this.frameDriver,
      frames,
      rafFps: frames * 1000 / totalMs,
      driverFps: frames * 1000 / totalMs,
      deltaAvg: frames ? sum(this.samples) / frames : 0,
      deltaP50: percentile(deltas, 0.50),
      deltaP95: percentile(deltas, 0.95),
      deltaP99: percentile(deltas, 0.99),
      deltaMax: deltas.at(-1) ?? 0,
      over20: this.samples.filter(value => value > 20).length,
      over25: this.samples.filter(value => value > 25).length,
      over33: this.samples.filter(value => value > 33.34).length,
      renderAvg: this.renderTimes.length
        ? sum(this.renderTimes) / this.renderTimes.length
        : 0,
      renderP95: percentile(renders, 0.95),
      renderMax: renders.at(-1) ?? 0,
      tapCount: this.tapTimes.length,
      tapAvg: this.tapTimes.length ? sum(this.tapTimes) / this.tapTimes.length : 0,
      tapP95: percentile(taps, 0.95),
      tapMax: taps.at(-1) ?? 0,
      audioCount: this.audioTimes.length,
      audioAvg: this.audioTimes.length ? sum(this.audioTimes) / this.audioTimes.length : 0,
      audioP95: percentile(audio, 0.95),
      audioMax: audio.at(-1) ?? 0,
      tapRafCount: this.tapToRafTimes.length,
      tapToRafAvg: this.tapToRafTimes.length ? sum(this.tapToRafTimes) / this.tapToRafTimes.length : 0,
      tapToRafP95: percentile(tapToRaf, 0.95),
      tapToRafMax: tapToRaf.at(-1) ?? 0,
      tapFrameDeltaAvg: this.tapFrameDeltas.length ? sum(this.tapFrameDeltas) / this.tapFrameDeltas.length : 0,
      tapFrameDeltaP95: percentile(tapFrames, 0.95),
      tapFrameDeltaMax: tapFrames.at(-1) ?? 0,
      tapFramesOver20: this.tapFrameDeltas.filter(value => value > 20).length,
      tapFramesOver25: this.tapFrameDeltas.filter(value => value > 25).length,
      tapFramesOver33: this.tapFrameDeltas.filter(value => value > 33.34).length,
      steps0: this.steps.filter(value => value === 0).length,
      steps1: this.steps.filter(value => value === 1).length,
      steps2plus: this.steps.filter(value => value >= 2).length,
      maxSteps: this.steps.length ? Math.max(...this.steps) : 0,
    };

    this.result = result;
    return result;
  }

  format(result = this.result) {
    if (!result) {
      return 'Aucun profil disponible.';
    }

    const percentage = (value, total) =>
      total ? Math.round(value * 100 / total) : 0;

    return [
      `Profil ${(result.durationMs / 1000).toFixed(1)} s`,
      `driver ${result.frameDriver ?? 'raf'} ${result.driverFps?.toFixed?.(1) ?? result.rafFps.toFixed(1)} fps`,
      `delta moy ${result.deltaAvg.toFixed(2)} ms | p95 ${result.deltaP95.toFixed(2)} | p99 ${result.deltaP99.toFixed(2)} | max ${result.deltaMax.toFixed(2)}`,
      `>20 ms ${result.over20} (${percentage(result.over20, result.frames)}%) | >25 ms ${result.over25} | >33 ms ${result.over33}`,
      `render moy ${result.renderAvg.toFixed(2)} ms | p95 ${result.renderP95.toFixed(2)} | max ${result.renderMax.toFixed(2)}`,
      `tap ${result.tapCount} | moy ${result.tapAvg.toFixed(3)} ms | p95 ${result.tapP95.toFixed(3)} | max ${result.tapMax.toFixed(3)}`,
      `audio wing ${result.audioCount} | moy ${result.audioAvg.toFixed(3)} ms | p95 ${result.audioP95.toFixed(3)} | max ${result.audioMax.toFixed(3)}`,
      `tap→frame ${result.tapRafCount} | moy ${result.tapToRafAvg.toFixed(2)} ms | p95 ${result.tapToRafP95.toFixed(2)} | max ${result.tapToRafMax.toFixed(2)}`,
      `frame avec tap moy ${result.tapFrameDeltaAvg.toFixed(2)} ms | p95 ${result.tapFrameDeltaP95.toFixed(2)} | max ${result.tapFrameDeltaMax.toFixed(2)} | >25 ${result.tapFramesOver25}`,
      `ticks/rAF 0:${result.steps0} 1:${result.steps1} 2+:${result.steps2plus} | max ${result.maxSteps}`,
    ].join('\n');
  }
}
