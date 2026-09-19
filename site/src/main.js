import { Renderer, loadAtlas } from './atlas.js';
import { Audio } from './audio.js';
import { FixedClock } from './clock.js';
import {
  LOGICAL_WIDTH,
  computeDisplaySize,
  defaultAspectForCapabilities,
  renderQualityScale,
} from './display.js';
import { Game } from './game.js';
import { PerfProfiler } from './perf.js';

const VERSION = '0.2.2b';
const BEST_SCORE_KEY = 'flappy13-personal-best-v1';
const SETTINGS_KEY = 'flappy13-settings-v1';
const MAX_REPLAY_INPUTS = 30000;

const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);

const canvas = $('game');
const stage = $('stage');
const options = $('options');
const audio = new Audio();
const clock = new FixedClock(60);
const profiler = new PerfProfiler(10000);

let game;
let renderer;
let paused = false;
let debug = query.has('debug');
let installPrompt = null;
let cacheInfo = null;
let remoteVersion = null;
let updateCheckTimer = null;
let lastPerfResult = null;
let cachedDebugState = null;
let rafCount = 0;
let tickCount = 0;
let statsAt = 0;
let previousCommands = null;
let currentCommands = null;
let resizeQueued = 0;
let orientationBlocked = false;
let pendingTap = null;
let lastInputSignature = '';
let droppedReplay = false;
let toastTimer = null;

const touchRecords = new Map();
const trace = [];

let displayLayout = {
  width: 288,
  height: 512,
  gameWidth: 288,
  gameHeight: 512,
  scaleX: 1,
  scaleY: 1,
  topGap: 0,
  bottomGap: 0,
  topPad: 0,
  bottomPad: 0,
  totalLogicalHeight: 512,
};

const urlSeed = Number(query.get('seed'));
const seed = query.has('seed') && Number.isFinite(urlSeed)
  ? urlSeed | 0
  : Date.now() | 0;

let best = 0;

try {
  const storedBest = Number(localStorage.getItem(BEST_SCORE_KEY));

  if (
    Number.isInteger(storedBest) &&
    storedBest >= 0 &&
    storedBest <= 2147483647
  ) {
    best = storedBest;
  }
} catch {
  // localStorage can be unavailable in hardened/private browser contexts.
}

const bootBest = best;
const desktopDefault = matchMedia('(hover: hover) and (pointer: fine)').matches;
const settings = {
  sound: true,
  aspect: defaultAspectForCapabilities({ desktop: desktopDefault }),
  performance: false,
};

try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');

  if (saved && typeof saved === 'object') {
    if (typeof saved.sound === 'boolean') {
      settings.sound = saved.sound;
    }

    if (saved.aspect === 'adapted' || saved.aspect === 'original') {
      settings.aspect = saved.aspect;
    }

    if (typeof saved.performance === 'boolean') {
      settings.performance = saved.performance;
    }
  }
} catch {
  // Invalid/missing settings simply fall back to defaults.
}

$('sound').checked = settings.sound;
$('aspect').value = settings.aspect;
$('performance-mode').checked = settings.performance;
audio.muted = !settings.sound;

function toast(text, ms = 4500) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, ms);
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings remain valid for the current session.
  }
}

function saveBest(value) {
  best = Math.max(best, value);

  try {
    localStorage.setItem(BEST_SCORE_KEY, String(best));
  } catch {
    toast('Record conservé pour cette session uniquement.');
  }

  $('best-score').textContent = best;
}

function resize() {
  if (orientationBlocked) {
    return;
  }

  const size = computeDisplaySize(stage.clientWidth, stage.clientHeight, {
    aspect: settings.aspect,
  });

  displayLayout = size;
  stage.dataset.aspect = settings.aspect;
  stage.style.setProperty('--game-width', `${size.gameWidth}px`);
  stage.style.setProperty('--game-height', `${size.gameHeight}px`);
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;

  if (!renderer) {
    return;
  }

  renderer.configureViewport({
    topPad: size.topPad,
    bottomPad: size.bottomPad,
    adapted: settings.aspect === 'adapted',
    renderScale: renderQualityScale(devicePixelRatio, {
      performance: settings.performance,
    }),
  });

  if (game && currentCommands) {
    render(clock.alpha());
  }
}

function scheduleResize() {
  if (resizeQueued || orientationBlocked) {
    return;
  }

  resizeQueued = requestAnimationFrame(() => {
    resizeQueued = 0;
    resize();
  });
}

function isMobileClass() {
  const shortestSide = Math.min(
    screen.width || innerWidth,
    screen.height || innerHeight,
  );
  return navigator.maxTouchPoints > 0 && shortestSide < 1200;
}

function isLandscape() {
  return innerWidth > innerHeight;
}

async function tryLockPortrait() {
  if (!isMobileClass() || !screen.orientation?.lock) {
    return false;
  }

  try {
    await screen.orientation.lock('portrait-primary');
    return true;
  } catch {
    return false;
  }
}

function updateOrientationGuard() {
  const blocked = isMobileClass() && isLandscape();

  orientationBlocked = blocked;
  $('orientation-lock').hidden = !blocked;

  if (blocked) {
    clearInput();
    clock.reset();
    return;
  }

  setTimeout(scheduleResize, 80);
}

function openOptions(showScores = false) {
  if (!game) {
    return;
  }

  audio.unlock();
  $('scores-message').hidden = !showScores;
  $('best-score').textContent = best;

  if (!options.open) {
    options.showModal();
  }

  clearInput();
  clock.reset();
  startUpdateChecks();
}

function closeOptions() {
  options.close();
  clearInput();
  clock.reset();
  stopUpdateChecks();
  canvas.focus({ preventScroll: true });
}

function clearInput() {
  touchRecords.clear();
  pendingTap = null;
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const cssScale = rect.width / LOGICAL_WIDTH || 1;

  return {
    x: Math.trunc((event.clientX - rect.left) / cssScale),
    y: Math.trunc(
      (event.clientY - rect.top) / cssScale - displayLayout.topPad,
    ),
  };
}

function press(id, point) {
  if (!game || options.open) {
    return;
  }

  audio.unlock();
  touchRecords.set(id, {
    ...point,
    released: false,
    seen: false,
  });
  pendingTap = point;
}

function release(id) {
  const point = touchRecords.get(id);

  if (!point) {
    return;
  }

  if (point.seen) {
    touchRecords.delete(id);
  } else {
    point.released = true;
  }
}

canvas.addEventListener('pointerdown', event => {
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }

  event.preventDefault();
  tryLockPortrait();
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  press(event.pointerId, pointerPosition(event));
});

canvas.addEventListener('pointerup', event => {
  event.preventDefault();
  release(event.pointerId);
});

canvas.addEventListener('pointercancel', event => {
  touchRecords.delete(event.pointerId);
});

canvas.addEventListener('contextmenu', event => {
  event.preventDefault();
});

window.addEventListener('keydown', event => {
  if (options.open) {
    return;
  }

  if (event.code === 'Escape') {
    event.preventDefault();
    openOptions();
    return;
  }

  if (['Space', 'ArrowUp', 'Enter'].includes(event.code)) {
    event.preventDefault();

    if (event.repeat) {
      return;
    }

    // Keyboard control is a PWA convenience, absent from the Android APK.
    const point = game?.play.active
      ? { x: 78, y: 375 }
      : { x: 144, y: 256 };

    press('keyboard', point);
    return;
  }

  if (event.code === 'KeyH') {
    setDebug(!debug);
  } else if (debug && event.code === 'KeyP') {
    paused = !paused;
    syncPause();
  } else if (debug && event.code === 'KeyN') {
    paused = true;
    syncPause();
    tick();
    render();
  }
});

window.addEventListener('keyup', event => {
  if (['Space', 'ArrowUp', 'Enter'].includes(event.code)) {
    event.preventDefault();
    release('keyboard');
  }
});

window.addEventListener('blur', () => {
  clearInput();
  clock.reset();
});

document.addEventListener('visibilitychange', () => {
  clearInput();
  clock.reset();

  if (!document.hidden) {
    tryLockPortrait();
    updateOrientationGuard();
  }
});

window.addEventListener('resize', scheduleResize);
window.visualViewport?.addEventListener('resize', scheduleResize);
window.addEventListener('orientationchange', updateOrientationGuard);
screen.orientation?.addEventListener?.('change', updateOrientationGuard);

$('open-options').onclick = () => openOptions();
$('close-options').onclick = closeOptions;

options.addEventListener('close', () => {
  clock.reset();
  stopUpdateChecks();
});

$('aspect').onchange = () => {
  settings.aspect = $('aspect').value;
  saveSettings();
  scheduleResize();
};

$('performance-mode').onchange = () => {
  settings.performance = $('performance-mode').checked;
  saveSettings();
  resize();
  toast(
    settings.performance
      ? 'Mode Performance : rendu interne plafonné à ×2.'
      : 'Mode Performance désactivé.',
  );
};

$('sound').onchange = () => {
  settings.sound = $('sound').checked;
  saveSettings();
  audio.muted = !settings.sound;
  audio.unlock();
};

function setDebug(value) {
  debug = value;
  $('debug').checked = debug;
  $('diagnostic').hidden = !debug;
  render();
}

$('debug').onchange = () => {
  setDebug($('debug').checked);
};

function syncPause() {
  $('pause').textContent = paused ? 'Reprendre' : 'Pause';
  clock.reset();
}

$('pause').onclick = () => {
  paused = !paused;
  syncPause();
};

$('step').onclick = () => {
  paused = true;
  syncPause();
  tick();
  render();
};

function nextInput() {
  const touches = [...touchRecords.values()].map(({ x, y }) => ({ x, y }));
  const input = { touches };

  if (pendingTap) {
    input.tap = pendingTap;
    pendingTap = null;
  }

  for (const [id, point] of touchRecords) {
    point.seen = true;

    if (point.released) {
      touchRecords.delete(id);
    }
  }

  return input;
}

function cloneCommands(commands) {
  return commands.map(command => ({ ...command }));
}

function tick(input = nextInput()) {
  if (currentCommands) {
    previousCommands = cloneCommands(currentCommands);
  }

  const signature = JSON.stringify(input);

  if (input.tap || signature !== lastInputSignature) {
    if (trace.length < MAX_REPLAY_INPUTS) {
      trace.push({
        frame: game.frame + 1,
        ...structuredClone(input),
      });
    } else {
      droppedReplay = true;
    }

    lastInputSignature = signature;
  }

  game.tick(input);
  currentCommands = cloneCommands(game.commands);

  if (!previousCommands) {
    previousCommands = cloneCommands(currentCommands);
  }

  if (debug) {
    cachedDebugState = game.snapshot();
  }

  tickCount++;
}

function render(alpha = 1) {
  if (!renderer || !game) {
    return;
  }

  renderer.drawInterpolated(
    previousCommands ?? game.commands,
    currentCommands ?? game.commands,
    alpha,
    debug ? cachedDebugState : null,
  );
}

function perfText(result = lastPerfResult) {
  return profiler.format(result);
}

function startProfiler() {
  profiler.start(performance.now());
  lastPerfResult = null;
  $('perf-output').textContent = 'Profil en cours pendant 10 s…';
  $('profile').disabled = true;
}

function downloadJson(filename, data) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function exportPerf() {
  downloadJson(`flappy13-perf-${Date.now()}.json`, {
    schema: 'flappy13-perf-v1',
    version: VERSION,
    userAgent: navigator.userAgent,
    devicePixelRatio,
    viewport: {
      innerWidth,
      innerHeight,
    },
    result: lastPerfResult,
  });
}

$('profile').onclick = startProfiler;
$('export-perf').onclick = exportPerf;

function animate(now) {
  rafCount++;

  if (
    game &&
    !options.open &&
    !document.hidden &&
    !paused &&
    !orientationBlocked
  ) {
    const steps = clock.steps(now);

    for (let index = 0; index < steps; index++) {
      tick();
    }

    // Always render on rAF. Safari jitter can otherwise create a visible
    // 1/0/2-tick cadence even when average simulation speed remains 60 Hz.
    const renderStarted = performance.now();
    render(clock.alpha());
    const renderMs = performance.now() - renderStarted;
    const result = profiler.frame(now, steps, renderMs);

    if (result) {
      lastPerfResult = result;
      $('perf-output').textContent = perfText(result);
      $('profile').disabled = false;
      $('export-perf').disabled = false;
    }
  } else {
    clock.reset();
  }

  if (now - statsAt >= 500) {
    if (debug && game) {
      const snapshot = game.snapshot();
      const elapsed = now - statsAt;

      $('stats').textContent = [
        `${snapshot.state} | tick ${snapshot.frame}`,
        `updates/s ${Math.round(tickCount * 1000 / elapsed)} | rAF/s ${Math.round(rafCount * 1000 / elapsed)}`,
        `seed ${snapshot.seed}`,
        `bird (${snapshot.bird.x}, ${snapshot.bird.y})`,
        `v=${snapshot.bird.velocity.toFixed(7)} | rot=${snapshot.bird.rotation.toFixed(4)}`,
        `score=${snapshot.score} | hidden=${snapshot.hidden}`,
        `pipes ${snapshot.pipes.map(pipe => `${pipe.x}:${pipe.y}`).join(' / ')}`,
      ].join('\n');
    }

    statsAt = now;
    tickCount = 0;
    rafCount = 0;
  }

  requestAnimationFrame(animate);
}

function replayData() {
  return {
    schema: 'flappy13-replay-v1',
    version: VERSION,
    seed,
    bestAtBoot: bootBest,
    totalFrames: game.frame,
    truncated: droppedReplay,
    inputs: structuredClone(trace),
    final: game.snapshot(),
  };
}

function exportReplay() {
  downloadJson(
    `flappy13-${seed}-${game.frame}.json`,
    replayData(),
  );
}

$('export').onclick = exportReplay;

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  $('install').hidden = false;
});

$('install').onclick = async () => {
  if (!installPrompt) {
    return;
  }

  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install').hidden = true;

  try {
    await navigator.storage?.persist?.();
  } catch {
    // Persistence is best-effort and browser-dependent.
  }
};

window.addEventListener('appinstalled', () => {
  $('install').hidden = true;
  tryLockPortrait();
  toast('Application installée.');
});

async function checkOffline() {
  const controller = navigator.serviceWorker?.controller;

  if (!controller) {
    return false;
  }

  const status = await new Promise(resolve => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => resolve(null), 5000);

    channel.port1.onmessage = event => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data);
    };

    controller.postMessage(
      { type: 'VERIFY_CACHE' },
      [channel.port2],
    );
  });

  cacheInfo = status;

  if (status?.complete) {
    $('offline-status').textContent =
      `Hors ligne prêt - ${status.count} ressources en cache.`;
    return true;
  }

  $('offline-status').textContent =
    'Cache incomplet : garder la connexion et recharger le jeu.';
  return false;
}

async function checkUpdateSource({ silent = false } = {}) {
  const button = $('refresh-cache');
  const status = $('update-status');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2200);
  const versionUrl = new URL('./version.json', location.href);

  versionUrl.searchParams.set('_check', String(Date.now()));

  let reachable = false;
  remoteVersion = null;

  try {
    const response = await fetch(versionUrl, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (response.ok) {
      const body = await response.json();
      reachable = typeof body?.version === 'string';
      remoteVersion = reachable ? body.version : null;
    }
  } catch {
    // Offline, captive portal, timeout, or host unavailable.
  } finally {
    clearTimeout(timeout);
  }

  button.disabled = !reachable;

  if (reachable) {
    status.textContent =
      `Hébergement joignable · version ${remoteVersion} : mise à jour manuelle disponible.`;
  } else {
    status.textContent =
      'Hébergement non joignable : mise à jour désactivée.';
  }

  if (!silent && !reachable) {
    toast('Hébergement introuvable : impossible de vider le cache en sécurité.');
  }

  return reachable;
}

function stopUpdateChecks() {
  clearInterval(updateCheckTimer);
  updateCheckTimer = null;
}

function startUpdateChecks() {
  stopUpdateChecks();
  $('refresh-cache').disabled = true;
  $('update-status').textContent = 'Recherche de la version publiée…';
  checkUpdateSource({ silent: true });

  // Poll only while options are open: no background network work during play.
  updateCheckTimer = setInterval(() => {
    if (options.open) {
      checkUpdateSource({ silent: true });
    } else {
      stopUpdateChecks();
    }
  }, 5000);
}

async function flushCacheAndUpdate() {
  const button = $('refresh-cache');

  if (!await checkUpdateSource()) {
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Mise à jour…';

  try {
    // Recheck before destructive work, then purge only this app's caches.
    if (!await checkUpdateSource()) {
      throw new Error('L’hébergement ne répond plus.');
    }

    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(name => name.startsWith('flappy13-'))
          .map(name => caches.delete(name)),
      );
    }

    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const currentScope = new URL('./', location.href).href;

      await Promise.all(
        registrations
          .filter(registration => registration.scope === currentScope)
          .map(registration => registration.unregister()),
      );
    }

    const target = new URL(location.href);
    target.searchParams.set('_update', String(Date.now()));
    location.replace(target.href);
  } catch (error) {
    button.textContent = originalText;
    await checkUpdateSource({ silent: true });
    toast(`Mise à jour annulée : ${error.message}`);
  }
}

$('refresh-cache').onclick = flushCacheAndUpdate;

window.addEventListener('online', () => {
  if (options.open) {
    checkUpdateSource({ silent: true });
  }
});

window.addEventListener('offline', () => {
  $('refresh-cache').disabled = true;
  $('update-status').textContent =
    'Hébergement non joignable : mise à jour désactivée.';
});

async function setupPWA() {
  if (!isSecureContext || !('serviceWorker' in navigator)) {
    $('offline-status').textContent =
      'Mode hors ligne PWA indisponible ici. Ouvrir sur localhost ou en HTTPS.';
    return;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    checkOffline();
  });

  const registration = await navigator.serviceWorker.register(
    new URL('../sw.js', import.meta.url),
    { updateViaCache: 'none' },
  );

  await navigator.serviceWorker.ready;

  // Ask the browser to check for a newer worker whenever the app starts online.
  try {
    await registration.update();
  } catch {
    // The cached application remains playable offline.
  }

  if (await checkOffline()) {
    toast('Hors ligne prêt : le jeu et ses sons sont en cache.');
  }
}

async function boot() {
  try {
    if (location.protocol === 'file:') {
      throw new Error(
        'Servez le dossier site/ via HTTP(S). Le jeu ne peut pas être lancé directement en file://.',
      );
    }

    const [atlas] = await Promise.all([
      loadAtlas(),
      audio.preload(),
    ]);

    renderer = new Renderer(canvas, atlas);
    game = new Game({
      seed,
      best,
      onEvent: ({ type, value }) => {
        if (type === 'sound') {
          audio.play(value);
        } else if (type === 'record') {
          saveBest(value);
        } else if (type === 'local-scores') {
          openOptions(true);
        } else if (type === 'about') {
          openOptions(false);
        }
      },
    });

    $('loading').hidden = true;
    setDebug(debug);
    updateOrientationGuard();
    resize();
    tick({ touches: [] });
    cachedDebugState = debug ? game.snapshot() : null;
    render();
    tryLockPortrait();
    requestAnimationFrame(animate);

    // Explicit diagnostics API. Ordinary controls do not expose gameplay cheats.
    window.flappy = {
      version: VERSION,
      get game() {
        return game;
      },
      get audio() {
        return audio;
      },
      snapshot: () => game.snapshot(),
      pause(value = true) {
        paused = value;
        syncPause();
      },
      step(input = { touches: [] }) {
        paused = true;
        syncPause();
        tick(input);
        render();
        return game.snapshot();
      },
      cache: () => cacheInfo,
      checkOffline,
      checkUpdateSource,
      flushCacheAndUpdate,
      exportReplay,
      replayData,
      startProfiler,
      perf: () => lastPerfResult,
      exportPerf,
      layout: () => structuredClone(displayLayout),
      tryLockPortrait,
    };

    setupPWA().catch(error => {
      $('offline-status').textContent =
        `Cache hors ligne non prêt : ${error.message}`;
      console.error(error);
    });
  } catch (error) {
    $('loading').hidden = false;
    $('loading').textContent = `Impossible de démarrer : ${error.message}`;
    console.error(error);
  }
}

boot();
