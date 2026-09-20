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

const VERSION = '0.2.6.3b';
const BEST_SCORE_KEY = 'flappy13-personal-best-v1';
const SETTINGS_KEY = 'flappy13-settings-v1';
const LAST_VERSION_KEY = 'flappy13-last-version-v1';
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const UPDATE_PROBE_TIMEOUT_MS = 3500;
const MAX_REPLAY_INPUTS = 30000;

const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);

const canvas = $('game');
const stage = $('stage');
const options = $('options');
const audio = new Audio({ version: VERSION });
const clock = new FixedClock(60);
const profiler = new PerfProfiler(10000);

let game;
let renderer;
let paused = false;
let debug = false;
let installPrompt = null;
let cacheInfo = null;
let remoteVersion = null;
let pendingUpdateVersion = null;
let swRegistration = null;
let updateCheckTimer = null;
let updateChecking = false;
let reloadOnControllerChange = false;
let lastUpdateToastVersion = null;
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
let lastUtilityVisibility = null;

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

function syncUtilityVisibility() {
  const button = $('open-options');
  const state = game?.state ?? 'MENU';
  const mode = state === 'MENU'
    ? 'options'
    : state === 'READY' || state === 'GAME_OVER'
      ? 'home'
      : 'hidden';
  const signature = `${mode}:${game?.fadeEvent ?? 0}:${game?.fade?.done ?? true}`;

  if (signature === lastUtilityVisibility) {
    return;
  }

  lastUtilityVisibility = signature;
  const visible = mode !== 'hidden'
    && (game?.fade?.done ?? true)
    && (mode !== 'options' || game?.fadeEvent !== 5);
  button.hidden = !visible;
  button.dataset.mode = mode;
  button.title = mode === 'home' ? 'Retour à l’accueil' : 'Options (Echap)';
  button.setAttribute(
    'aria-label',
    mode === 'home' ? 'Retourner à l’écran d’accueil' : 'Ouvrir les options',
  );
  $('utility-menu-icon').hidden = mode !== 'options';
  $('utility-home-icon').hidden = mode !== 'home';
}

function returnToHome() {
  const state = game?.state;

  if (!game || !['READY', 'GAME_OVER'].includes(state) || !game.fade.done) {
    return;
  }

  audio.note('HOME_NAVIGATION', { from: state });
  clearInput();
  game.transition(true, 6, 0.25);
  syncUtilityVisibility();
  clock.reset();
}

function openOptions(showScores = false) {
  if (!game) {
    return;
  }

  audio.note('SETTINGS_OPEN', { showScores });
  audio.unlock('settings-open');
  $('scores-message').hidden = !showScores;
  $('best-score').textContent = best;

  if (!options.open) {
    options.showModal();
  }

  syncUtilityVisibility();
  clearInput();
  clock.reset();
  checkForUpdates({ silent: true, reason: 'options-open' });
}

function closeOptions() {
  audio.note('SETTINGS_CLOSE');
  options.close();
  syncUtilityVisibility();
  clearInput();
  clock.reset();
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

  audio.unlock('game-input');
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

    if (game?.state === 'MENU') {
      openOptions();
    } else if (game?.state === 'READY' || game?.state === 'GAME_OVER') {
      returnToHome();
    }

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

  if (debug && event.code === 'KeyP') {
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
  audio.note('WINDOW_BLUR');
  clearInput();
  clock.reset();
});

window.addEventListener('focus', () => {
  audio.note('WINDOW_FOCUS');
  audio.recover('window-focus');
});

window.addEventListener('pageshow', event => {
  audio.note('PAGE_SHOW', { persisted: event.persisted });
  audio.recover('pageshow');

  if (swRegistration && navigator.onLine) {
    checkForUpdates({ silent: true, reason: 'pageshow' });
  }
});

window.addEventListener('pagehide', event => {
  audio.note('PAGE_HIDE', { persisted: event.persisted });
});

document.addEventListener('visibilitychange', () => {
  audio.note('VISIBILITY_CHANGE', { state: document.visibilityState });
  clearInput();
  clock.reset();

  if (!document.hidden) {
    audio.recover('visibility-visible');
    tryLockPortrait();
    updateOrientationGuard();

    if (swRegistration && navigator.onLine) {
      checkForUpdates({ silent: true, reason: 'foreground' });
    }
  }
});

window.addEventListener('resize', scheduleResize);
window.visualViewport?.addEventListener('resize', scheduleResize);
window.addEventListener('orientationchange', updateOrientationGuard);
screen.orientation?.addEventListener?.('change', updateOrientationGuard);

$('open-options').onclick = () => {
  if (game?.state === 'READY' || game?.state === 'GAME_OVER') {
    returnToHome();
  } else {
    openOptions();
  }
};
$('close-options').onclick = closeOptions;

options.addEventListener('close', () => {
  audio.note('SETTINGS_DIALOG_CLOSED');
  syncUtilityVisibility();
  clock.reset();
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
  audio.note('SOUND_SETTING_CHANGED', { enabled: settings.sound });
  audio.unlock('sound-toggle');
};

function setDebug(value) {
  const changed = debug !== Boolean(value);
  debug = Boolean(value);
  $('diagnostic').hidden = !debug;
  $('debug-access').textContent = debug
    ? 'Masquer les outils de diagnostic'
    : 'Outils de diagnostic';

  if (changed) {
    audio.note(debug ? 'DEBUG_ENABLED' : 'DEBUG_DISABLED');
  }

  render();
}

$('debug-access').onclick = () => {
  const enable = !debug;
  setDebug(enable);

  if (enable) {
    closeOptions();
  }
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
  syncUtilityVisibility();
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

function audioDiagnosticData() {
  return audio.diagnostics({
    app: {
      paused,
      debug,
      optionsOpen: options.open,
      orientationBlocked,
      online: navigator.onLine,
      gameFrame: game?.frame ?? null,
      gameState: game?.snapshot?.().state ?? null,
    },
  });
}

function exportAudioDiagnostics() {
  downloadJson(`flappy13-audio-${Date.now()}.json`, audioDiagnosticData());
}

async function copyAudioDiagnostics() {
  const text = JSON.stringify(audioDiagnosticData(), null, 2);

  try {
    await navigator.clipboard.writeText(text);
    toast('Diagnostic audio copié.');
    return;
  } catch {
    // Clipboard API can be unavailable in standalone Safari/PWA contexts.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();

  try {
    document.execCommand('copy');
    toast('Diagnostic audio copié.');
  } catch {
    toast('Copie impossible : utilisez Exporter audio.');
  } finally {
    textarea.remove();
  }
}

$('copy-audio').onclick = copyAudioDiagnostics;
$('export-audio').onclick = exportAudioDiagnostics;

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

      const audioState = audio.summary();
      $('audio-status').textContent = [
        `AUDIO context=${audioState.context} muted=${audioState.muted}`,
        `buffers=${audioState.buffersLoaded}/${audioState.rawLoaded} focus=${audioState.focus}`,
        `visibility=${audioState.visibility}`,
        `last=${audioState.lastSound ?? '-'} -> ${audioState.lastSoundResult ?? '-'}`,
        `event=${audioState.lastEvent ?? '-'} (${audioState.eventCount})`,
        `error=${audioState.error ?? '-'}`,
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
    $('offline-status').textContent = 'Disponible hors connexion.';
    return true;
  }

  $('offline-status').textContent =
    'Le mode hors connexion se pr\u00e9pare encore. Gardez la connexion quelques instants.';
  return false;
}

function updateButton({ text, disabled }) {
  const button = $('refresh-cache');
  button.textContent = text;
  button.disabled = disabled;
}

function rememberVersion() {
  let previous = null;

  try {
    previous = localStorage.getItem(LAST_VERSION_KEY);
    localStorage.setItem(LAST_VERSION_KEY, VERSION);
  } catch {
    // Version notices are cosmetic only.
  }

  return previous && previous !== VERSION ? previous : null;
}

async function publishedVersion() {
  if (!navigator.onLine) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_PROBE_TIMEOUT_MS);
  const versionUrl = new URL('./version.json', location.href);
  versionUrl.searchParams.set('_check', String(Date.now()));

  try {
    const response = await fetch(versionUrl, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return null;
    }

    const body = await response.json();
    return typeof body?.version === 'string' ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function workerBuild(worker) {
  if (!worker) {
    return null;
  }

  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, 1500);

    channel.port1.onmessage = event => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(typeof event.data?.build === 'string' ? event.data.build : null);
    };

    try {
      worker.postMessage({ type: 'GET_BUILD' }, [channel.port2]);
    } catch {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(null);
    }
  });
}

async function markUpdateReady(version = null) {
  const waiting = swRegistration?.waiting;

  if (!waiting) {
    return false;
  }

  pendingUpdateVersion =
    version ||
    await workerBuild(waiting) ||
    remoteVersion ||
    'nouvelle version';

  $('update-status').textContent =
    `Mise \u00e0 jour ${pendingUpdateVersion} pr\u00eate \u00b7 installation automatique au prochain lancement.`;
  updateButton({ text: 'Installer maintenant', disabled: false });

  if (lastUpdateToastVersion !== pendingUpdateVersion) {
    lastUpdateToastVersion = pendingUpdateVersion;
    toast(
      `Une mise \u00e0 jour ${pendingUpdateVersion} est pr\u00eate. Elle s\u2019installera au prochain lancement.`,
      6500,
    );
  }

  return true;
}

function watchInstallingWorker(worker) {
  if (!worker) {
    return;
  }

  const onStateChange = async () => {
    if (worker.state === 'installed' && swRegistration?.waiting) {
      worker.removeEventListener('statechange', onStateChange);
      await markUpdateReady(remoteVersion);
    } else if (worker.state === 'redundant') {
      worker.removeEventListener('statechange', onStateChange);
      $('update-status').textContent =
        'La mise \u00e0 jour n\u2019a pas pu \u00eatre pr\u00e9par\u00e9e. Une nouvelle tentative sera faite automatiquement.';
      updateButton({
        text: 'Rechercher une mise \u00e0 jour',
        disabled: !navigator.onLine,
      });
    }
  };

  worker.addEventListener('statechange', onStateChange);
}

async function checkForUpdates({ silent = false, reason = 'manual' } = {}) {
  if (!isSecureContext || !('serviceWorker' in navigator)) {
    $('update-status').textContent =
      'Mises \u00e0 jour automatiques indisponibles dans ce navigateur.';
    updateButton({ text: 'Rechercher une mise \u00e0 jour', disabled: true });
    return 'unsupported';
  }

  if (!swRegistration) {
    return 'not-ready';
  }

  if (swRegistration.waiting) {
    await markUpdateReady();
    return 'ready';
  }

  if (updateChecking) {
    return 'checking';
  }

  updateChecking = true;
  updateButton({ text: 'Recherche en cours\u2026', disabled: true });

  try {
    const version = await publishedVersion();
    remoteVersion = version;

    if (!version) {
      $('update-status').textContent = navigator.onLine
        ? 'V\u00e9rification impossible pour le moment. Nouvelle tentative automatique plus tard.'
        : 'Hors connexion \u00b7 les mises \u00e0 jour reprendront automatiquement.';
      updateButton({
        text: 'Rechercher une mise \u00e0 jour',
        disabled: !navigator.onLine,
      });

      if (!silent && navigator.onLine) {
        toast('Impossible de v\u00e9rifier les mises \u00e0 jour pour le moment.');
      }

      return 'unreachable';
    }

    if (version === VERSION) {
      pendingUpdateVersion = null;
      $('update-status').textContent = `\u00c0 jour \u00b7 version ${VERSION}`;
      updateButton({ text: 'Rechercher une mise \u00e0 jour', disabled: false });

      if (!silent && reason === 'manual') {
        toast('Vous utilisez d\u00e9j\u00e0 la derni\u00e8re version.');
      }

      return 'current';
    }

    $('update-status').textContent =
      `Nouvelle version ${version} d\u00e9tect\u00e9e \u00b7 pr\u00e9paration en arri\u00e8re-plan\u2026`;

    try {
      await swRegistration.update();
    } catch {
      $('update-status').textContent =
        `Version ${version} d\u00e9tect\u00e9e, mais son t\u00e9l\u00e9chargement sera retent\u00e9 automatiquement.`;
      updateButton({ text: 'Rechercher une mise \u00e0 jour', disabled: false });
      return 'detected';
    }

    if (swRegistration.waiting) {
      await markUpdateReady(version);
      return 'ready';
    }

    if (swRegistration.installing) {
      watchInstallingWorker(swRegistration.installing);
      return 'installing';
    }

    $('update-status').textContent =
      `Version ${version} d\u00e9tect\u00e9e \u00b7 pr\u00e9paration automatique en cours.`;
    updateButton({ text: 'Rechercher une mise \u00e0 jour', disabled: false });
    return 'detected';
  } finally {
    updateChecking = false;
  }
}

function stopUpdateChecks() {
  clearInterval(updateCheckTimer);
  updateCheckTimer = null;
}

function startUpdateChecks() {
  stopUpdateChecks();

  updateCheckTimer = setInterval(() => {
    if (!document.hidden && navigator.onLine) {
      checkForUpdates({ silent: true, reason: 'timer' });
    }
  }, UPDATE_CHECK_INTERVAL_MS);
}

async function installPendingUpdate({ automatic = false } = {}) {
  const waiting = swRegistration?.waiting;

  if (!waiting) {
    if (!automatic) {
      await checkForUpdates({ silent: false, reason: 'manual' });
    }
    return false;
  }

  reloadOnControllerChange = true;
  $('update-status').textContent = 'Installation de la mise \u00e0 jour\u2026';
  updateButton({ text: 'Installation\u2026', disabled: true });

  try {
    waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
    return true;
  } catch (error) {
    reloadOnControllerChange = false;
    $('update-status').textContent =
      'La mise \u00e0 jour reste pr\u00eate et sera retent\u00e9e au prochain lancement.';
    updateButton({ text: 'Installer maintenant', disabled: false });

    if (!automatic) {
      toast(`Installation report\u00e9e : ${error.message}`);
    }

    return false;
  }
}

async function updateAction() {
  if (swRegistration?.waiting) {
    await installPendingUpdate();
    return;
  }

  await checkForUpdates({ silent: false, reason: 'manual' });
}

$('refresh-cache').onclick = updateAction;

window.addEventListener('online', () => {
  audio.note('NETWORK_ONLINE');
  checkForUpdates({ silent: true, reason: 'online' });
});

window.addEventListener('offline', () => {
  audio.note('NETWORK_OFFLINE');
  $('update-status').textContent =
    'Hors connexion \u00b7 les mises \u00e0 jour reprendront automatiquement.';
  updateButton({ text: 'Rechercher une mise \u00e0 jour', disabled: true });
});

async function setupPWA() {
  if (!isSecureContext || !('serviceWorker' in navigator)) {
    $('offline-status').textContent =
      'Le mode hors connexion n\u2019est disponible qu\u2019en HTTPS ou sur localhost.';
    $('update-status').textContent =
      'Mises \u00e0 jour automatiques indisponibles ici.';
    updateButton({ text: 'Rechercher une mise \u00e0 jour', disabled: true });
    return;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnControllerChange) {
      reloadOnControllerChange = false;
      location.reload();
      return;
    }

    checkOffline();
  });

  swRegistration = await navigator.serviceWorker.register(
    new URL('../sw.js', import.meta.url),
    { updateViaCache: 'none' },
  );

  swRegistration.addEventListener('updatefound', () => {
    watchInstallingWorker(swRegistration.installing);
  });

  await navigator.serviceWorker.ready;

  // A worker already waiting when the application starts belongs to an update
  // prepared during a previous session. Activating it here is safe: the player
  // has just launched the app, so no in-progress run is interrupted.
  const waitingAtLaunch = swRegistration.waiting;
  if (waitingAtLaunch) {
    const waitingBuild = await workerBuild(waitingAtLaunch);

    if (!waitingBuild || waitingBuild !== VERSION) {
      await markUpdateReady(waitingBuild);
      await installPendingUpdate({ automatic: true });
      return;
    }
  }

  const previousVersion = rememberVersion();
  const offlineReady = await checkOffline();

  if (previousVersion) {
    toast(`Mise \u00e0 jour termin\u00e9e \u00b7 version ${VERSION}`, 5500);
  } else if (offlineReady) {
    toast('Tout est pr\u00eat \u00b7 vous pouvez jouer m\u00eame hors connexion.', 5000);
  }

  // Check once at launch, then periodically and whenever the app comes back to
  // the foreground. A discovered build is downloaded in the background but is
  // never activated over an in-progress game.
  await checkForUpdates({ silent: true, reason: 'startup' });
  startUpdateChecks();
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
      checkForUpdates,
      installPendingUpdate,
      checkUpdateSource: checkForUpdates,
      flushCacheAndUpdate: installPendingUpdate,
      exportReplay,
      replayData,
      startProfiler,
      perf: () => lastPerfResult,
      exportPerf,
      audioDiagnostics: audioDiagnosticData,
      copyAudioDiagnostics,
      exportAudioDiagnostics,
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
