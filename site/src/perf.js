export class PerfProfiler {
  constructor(windowMs = 10000) {
    this.windowMs = windowMs;
    this.active = false;
    this.startedAt = 0;
    this.lastRaf = null;
    this.samples = [];
    this.steps = [];
    this.renderTimes = [];
    this.result = null;
  }

  start(now = performance.now()) {
    this.active = true;
    this.startedAt = now;
    this.lastRaf = null;
    this.samples.length = 0;
    this.steps.length = 0;
    this.renderTimes.length = 0;
    this.result = null;
  }

  frame(now, steps, renderMs) {
    if (!this.active) {
      return null;
    }

    if (this.lastRaf !== null) {
      this.samples.push(now - this.lastRaf);
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
      frames,
      rafFps: frames * 1000 / totalMs,
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
      `rAF ${result.rafFps.toFixed(1)} fps`,
      `delta moy ${result.deltaAvg.toFixed(2)} ms | p95 ${result.deltaP95.toFixed(2)} | p99 ${result.deltaP99.toFixed(2)} | max ${result.deltaMax.toFixed(2)}`,
      `>20 ms ${result.over20} (${percentage(result.over20, result.frames)}%) | >25 ms ${result.over25} | >33 ms ${result.over33}`,
      `render moy ${result.renderAvg.toFixed(2)} ms | p95 ${result.renderP95.toFixed(2)} | max ${result.renderMax.toFixed(2)}`,
      `ticks/rAF 0:${result.steps0} 1:${result.steps1} 2+:${result.steps2plus} | max ${result.maxSteps}`,
    ].join('\n');
  }
}
