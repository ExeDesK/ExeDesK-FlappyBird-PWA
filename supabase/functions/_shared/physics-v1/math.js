// Numeric semantics recovered from classes.dex / com.dotgears.j and .r.
// Java float rounds after EACH operation, not only after assignment to y.
export const F = Math.fround;

export const I = value => {
  if (Number.isNaN(value)) {
    return 0;
  }

  return (
    Math.min(
      2147483647,
      Math.max(-2147483648, Math.trunc(value)),
    ) | 0
  );
};

export const SIN = new Float32Array(360);
export const COS = new Float32Array(360);

for (let degree = 0; degree < 360; degree++) {
  const angle = F(F(F(degree) * F(3.1415925)) / F(180));
  SIN[degree] = F(Math.sin(angle));
  COS[degree] = F(Math.cos(angle));
}

export class Random {
  constructor(seed = 0) {
    this.seed(seed);
  }

  seed(value) {
    value |= 0;
    this.y = value % 32000;
    this.z = value % 65535;
  }

  next() {
    this.z = (Math.imul(36969, this.z & 65535) + (this.z >> 16)) | 0;
    this.y = (Math.imul(18000, this.y & 65535) + (this.y >> 16)) | 0;

    const value = ((this.z << 16) + this.y) | 0;

    // Java Math.abs(Integer.MIN_VALUE) remains negative. Do not silently fix it.
    return value === -2147483648 ? value : Math.abs(value);
  }

  range(min, max) {
    return (this.next() % (max - min)) + min;
  }
}

// Only easing IDs actually used by Flappy Bird 1.3 are necessary.
const EASING = new Map([
  [5, new Float32Array(101)],
  [11, new Float32Array(101)],
]);

for (let index = 0; index <= 100; index++) {
  const t = index / 100;
  const shifted = t - 1;

  EASING.get(5)[index] = F(shifted * shifted * shifted + 1);
  EASING.get(11)[index] = F(
    shifted * shifted * shifted * shifted * shifted + 1,
  );
}

export class Tween {
  constructor() {
    this.done = true;
    this.value = 0;
  }

  start(from, to, ease, seconds) {
    this.from = F(from);
    this.to = F(to);
    this.delta = F(this.to - this.from);
    this.total = I(F(F(60) * F(seconds)));
    this.inv = F(1 / this.total);
    this.count = 0;
    this.ease = ease;
    this.done = false;
    this.value = this.from;
  }

  tick() {
    if (this.done) {
      return;
    }

    this.count++;

    let progress = F(F(this.count) * this.inv);

    if (this.ease) {
      progress = EASING.get(this.ease)[I(F(progress * F(100)))];
    }

    this.value = F(F(progress * this.delta) + this.from);

    if (this.count === this.total) {
      this.done = true;
      this.value = this.to;
    }
  }
}

export class Animation {
  constructor(frames, fps, loop) {
    this.frames = frames;
    this.delay = Math.trunc(1000 / fps);
    this.loop = loop;
    this.reset();
  }

  reset() {
    this.elapsed = 0;
    this.index = 0;
    this.frame = this.frames[0];
    this.done = false;
  }

  tick() {
    if (this.done) {
      return;
    }

    this.elapsed += 15;

    if (this.elapsed < this.delay) {
      return;
    }

    this.elapsed = 0;
    this.index++;

    if (this.index >= this.frames.length) {
      if (!this.loop) {
        this.done = true;
      }

      this.index = 0;
    }

    this.frame = this.frames[this.index];
  }
}

export function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
  return (
    ax + aw >= bx &&
    ax <= bx + bw &&
    ay + ah >= by &&
    ay <= by + bh
  );
}
