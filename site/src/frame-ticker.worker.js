// Dedicated foreground ticker used as an iOS/WebKit workaround.
// It does not run game physics itself: each message only asks the main thread
// to execute the existing FixedClock(60) + render path.

let timerId = null;
let running = false;
let periodMs = 1000 / 60;
let nextAt = 0;

function stop() {
  running = false;
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
}

function schedule() {
  if (!running) {
    return;
  }

  const delay = Math.max(0, nextAt - performance.now());
  timerId = setTimeout(tick, delay);
}

function tick() {
  if (!running) {
    return;
  }

  const now = performance.now();
  postMessage({ type: 'frame' });

  nextAt += periodMs;
  // Never build a large callback backlog after a debugger pause or OS stall.
  if (nextAt < now - periodMs * 2) {
    nextAt = now + periodMs;
  }

  schedule();
}

self.onmessage = event => {
  if (event.data?.type === 'stop') {
    stop();
    return;
  }

  if (event.data?.type !== 'start') {
    return;
  }

  stop();
  const hz = Number(event.data.hz);
  const safeHz = Number.isFinite(hz) ? Math.max(30, Math.min(120, hz)) : 60;
  periodMs = 1000 / safeHz;
  nextAt = performance.now() + periodMs;
  running = true;
  schedule();
};
