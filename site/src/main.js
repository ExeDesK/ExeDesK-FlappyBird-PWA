import { Renderer, loadAtlas } from './atlas.js';
import { Audio } from './audio.js';
import { AuthClient } from './auth.js';
import { BestScoreClient } from './api/best-score-client.js';
import { LeaderboardClient } from './api/leaderboard-client.js';
import { VerifiedRunClient } from './api/verified-run-api.js';
import { FixedClock } from './clock.js';
import {
  LOGICAL_WIDTH,
  computeDisplaySize,
  defaultAspectForCapabilities,
  renderQualityScale,
} from './display.js';
import { Game } from './game.js';
import { PerfProfiler } from './perf.js';
import { PwaUpdateManager } from './pwa/update-manager.js';
import { ReplayViewer } from './replay/replay-viewer.js';
import { ScoreSyncController } from './session/score-sync.js';
import { VerifiedPlayController } from './session/verified-play.js';
import { AccountUI, providerLabel } from './ui/account.js';
import { LeaderboardUI } from './ui/leaderboard-ui.js';
import { ToastController } from './ui/toast.js';
import {
  effectiveDayNight,
  normalizeThemeMode,
  resolveRunTheme,
  themeDefinition,
  themeEntries,
} from './themes.js';
import { createCanonicalRunGame } from './verified-runs.js';

const VERSION = '0.2.7.7b-hotfix3';
const BEST_SCORE_KEY = 'flappy13-personal-best-v1';
const SETTINGS_KEY = 'flappy13-settings-v1';
const runtimeConfig = globalThis.FLAPPY_CONFIG && typeof globalThis.FLAPPY_CONFIG === 'object'
  ? globalThis.FLAPPY_CONFIG
  : {};
const SUPABASE_URL = typeof runtimeConfig.supabaseUrl === 'string'
  ? runtimeConfig.supabaseUrl
  : '';
const SUPABASE_PUBLISHABLE_KEY = typeof runtimeConfig.supabasePublishableKey === 'string'
  ? runtimeConfig.supabasePublishableKey
  : '';
const MAX_REPLAY_INPUTS = 30000;
const PLAY_FADE_SECONDS = 0.5;
const UTILITY_ATLAS_SCALE = 1.75;
const CLOSE_ATLAS_SCALE = 1;
const ATLAS_PRESS_MIN_MS = 70;

const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);

const canvas = $('game');
const stage = $('stage');
const options = $('options');
const profileDialog = $('profile-dialog');
const leaderboardDialog = $('leaderboard-dialog');
const replayDialog = $('replay-dialog');
const unrankedWarning = $('unranked-warning');
const audio = new Audio({ version: VERSION });
const auth = new AuthClient({
  url: SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
});
const clock = new FixedClock(60);
const profiler = new PerfProfiler(10000);
const toastController = new ToastController($('toast'));
const toast = (text, ms = 4500) => toastController.show(text, ms);
const apiConfig = {
  url: SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
  getAccessToken: () => auth.accessToken(),
};
const bestScoreClient = new BestScoreClient(apiConfig);
const leaderboardClient = new LeaderboardClient(apiConfig);
const verifiedRunApi = new VerifiedRunClient(apiConfig);
const leaderboardUI = new LeaderboardUI({
  auth,
  client: leaderboardClient,
  dialog: leaderboardDialog,
  toast,
  getElement: $,
  onWatchReplay: row => openLeaderboardReplay(row),
});
async function linkAccountProvider(provider) {
  try {
    await auth.linkIdentity(provider);
  } catch (error) {
    const label = providerLabel(provider);
    const message = String(error?.message || error || 'erreur OAuth');
    const friendly = /already.*linked|identity.*exists|already.*registered/i.test(message)
      ? `Ce compte ${label} est déjà lié à un autre profil. Connecte-toi avec ce compte pour retrouver son profil, ou utilise un autre compte ${label}.`
      : /manual.*link|linking.*disabled/i.test(message)
        ? 'La liaison de comptes doit être activée dans Supabase Auth avant de pouvoir ajouter un second moyen de connexion.'
        : `Impossible de lier ${label} : ${message}`;
    toast(friendly, 7000);
    throw error;
  }
}
async function unlinkAccountProvider(provider, identityId) {
  try {
    const state = await auth.unlinkIdentity(identityId);
    leaderboardUI.applyProfile(state.profile);
    return state;
  } catch (error) {
    const label = providerLabel(provider);
    const message = String(error?.message || error || 'erreur Auth');
    if (/dernier moyen de connexion/i.test(message)) throw new Error(`Impossible de délier ${label} : ajoute d’abord un second moyen de connexion.`);
    if (/manual.*link|linking.*disabled/i.test(message)) throw new Error('La gestion des identités doit être activée dans Supabase Auth.');
    throw new Error(`Impossible de délier ${label} : ${message}`);
  }
}
const accountUI = new AccountUI({
  auth,
  getBest: () => best,
  getScoreSyncState: () => scoreSync.snapshot(),
  getElement: $,
  onLinkProvider: linkAccountProvider,
  onUnlinkProvider: unlinkAccountProvider,
  onProfileUpdated: async state => {
    leaderboardUI.applyProfile(state.profile);
    if (leaderboardDialog.open && navigator.onLine) await leaderboardUI.load({ force: true });
  },
});
const scoreSync = new ScoreSyncController({
  auth,
  client: bestScoreClient,
  getBest: () => best,
  applyBest,
  onStateChange: ({ authState }) => accountUI.render(authState),
});
const pwaManager = new PwaUpdateManager({
  version: VERSION,
  getElement: $,
  toast,
});
const verifiedPlay = new VerifiedPlayController({
  auth,
  api: verifiedRunApi,
  leaderboard: leaderboardUI,
  toast,
  getElement: $,
  warningDialog: unrankedWarning,
  clearInput,
  resetClock: () => clock.reset(),
  playSwoosh: () => audio.play('swooshing'),
  syncUtilityVisibility,
  prepareVisualThemeForRun,
  activatePendingVisualTheme,
  cancelPendingVisualTheme: () => { pendingVisualTheme = null; },
  getVisualContextForRun: captureVisualContextForRun,
  installVerifiedGame,
  isCurrentGame: candidate => game === candidate,
  saveBest,
  playFadeSeconds: PLAY_FADE_SECONDS,
});

let game;
let renderer;
let replayViewer = null;
let themeCatalog = null;
let paused = false;
let debug = false;
let themeControls = { mode: 'auto', variant: 'day' };
let activeVisualTheme = { mode: 'auto', theme: 'original', variant: 'auto' };
let pendingVisualTheme = null;
let installPrompt = null;
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

function isAppleTouchDevice() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function measureNativeRafHz({ samples = 90 } = {}) {
  return new Promise((resolve) => {
    const deltas = [];
    let previous = 0;

    const sample = (now) => {
      if (previous > 0) {
        const delta = now - previous;
        if (delta > 0 && delta < 100) {
          deltas.push(delta);
        }
      }
      previous = now;

      if (deltas.length >= samples) {
        const sorted = [...deltas].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        resolve(median > 0 ? 1000 / median : 0);
        return;
      }

      requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  });
}

async function updateIosPromotionHint() {
  const hint = $('ios-promotion-hint');
  const status = $('ios-promotion-status');
  const help = $('ios-promotion-help');
  if (!hint || !status || !help || !isAppleTouchDevice()) {
    return;
  }

  hint.hidden = false;
  status.textContent = 'Mesure de la fréquence d’affichage…';

  const hz = await measureNativeRafHz();
  const roundedHz = Math.round(hz);

  if (hz >= 90) {
    hint.classList.add('is-active');
    status.textContent = `✓ Haute fréquence active (~${roundedHz} Hz). ProMotion est bien exploité par Safari.`;
    return;
  }

  hint.classList.remove('is-active');
  status.textContent = `Cadence web détectée : ~${roundedHz || 60} Hz.`;
}

updateIosPromotionHint();

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings remain valid for the current session.
  }
}

function applyBest(value) {
  const candidate = Number(value);
  if (!Number.isInteger(candidate) || candidate < 0 || candidate > 2147483647) {
    return false;
  }

  const previous = best;
  best = Math.max(best, candidate);

  try {
    localStorage.setItem(BEST_SCORE_KEY, String(best));
  } catch {
    toast('Record conservé pour cette session uniquement.');
  }

  if (game) {
    game.best = Math.max(game.best, best);
  }

  const profileBest = $('profile-best-score');
  if (profileBest) {
    profileBest.textContent = String(best);
  }
  return best !== previous;
}

function saveBest(value) {
  const changed = applyBest(value);
  if (changed) {
    void scoreSync.sync({ reason: 'new-record' });
  }
}

function handleGameEvent({ type, value }) {
  if (type === 'sound') {
    audio.play(value);
  } else if (type === 'record' && !verifiedPlay.recording) {
    // Ranked runs update persistent scores only after run-submit has replayed
    // them authoritatively. The Game may still render its in-run panel value.
    saveBest(value);
  } else if (type === 'local-scores') {
    openLeaderboard({ force: true });
  } else if (type === 'about') {
    toast('La fonctionnalité de notation n’est pas encore disponible. Merci pour ton soutien !');
  }
}

function installVerifiedGame(ticket) {
  const prepared = createCanonicalRunGame({
    seed: ticket.seed,
    best,
    onEvent: handleGameEvent,
  });

  game = prepared.game;
  clearInput();
  trace.length = 0;
  droppedReplay = false;
  lastInputSignature = '';
  cachedDebugState = debug ? game.snapshot() : null;
  lastUtilityVisibility = null;
  activatePendingVisualTheme();

  // The canonical run has already been warmed up to READY, so its command list
  // may contain a visible scene. Pin the replacement Game to black AND pin the
  // renderer caches to an explicitly black-composited frame before swapping it
  // onto screen. This prevents a prepared READY frame from flashing between the
  // old menu fade and the new game's reveal.
  game.fade.done = true;
  game.fade.value = 1;

  const blackCommands = cloneCommands(game.commands);
  blackCommands.push({
    name: 'black',
    x: -144,
    y: -256,
    alpha: 1,
    angle: 0,
    w: 864,
    h: 1536,
    key: undefined,
  });
  previousCommands = cloneCommands(blackCommands);
  currentCommands = cloneCommands(blackCommands);

  clock.reset();
  syncUtilityVisibility();
  render(1);
  game.transition(false, 0, PLAY_FADE_SECONDS);

  return { warmupFrames: prepared.warmupFrames };
}

auth.onChange(state => {
  accountUI.render(state);
  leaderboardUI.onAuthChange(state);
});
accountUI.render();
leaderboardUI.render();

$('discord-login').onclick = () => {
  try {
    auth.signInWithDiscord();
  } catch (error) {
    toast(error.message);
  }
};

$('google-login').onclick = () => {
  try {
    auth.signInWithProvider('google');
  } catch (error) {
    toast(error.message);
  }
};

$('discord-logout').onclick = async () => {
  $('discord-logout').disabled = true;
  await auth.signOut();
  scoreSync.reset();
  accountUI.render(auth.snapshot());
};

$('refresh-leaderboard').onclick = () => {
  void leaderboardUI.refreshAll({ force: true, notify: true });
};

function resize() {
  if (orientationBlocked) {
    return;
  }

  const size = computeDisplaySize(stage.clientWidth, stage.clientHeight, {
    aspect: settings.aspect,
  });

  displayLayout = size;
  stage.dataset.aspect = settings.aspect;
  const gameSideGap = Math.max(0, (stage.clientWidth - size.gameWidth) / 2);

  stage.style.setProperty('--game-width', `${size.gameWidth}px`);
  stage.style.setProperty('--game-height', `${size.gameHeight}px`);
  document.documentElement.style.setProperty('--game-side-gap', `${gameSideGap}px`);
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  updateCanvasRect();

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

function currentThemeDayNight() {
  return effectiveDayNight(game?.background ?? 'bg_day', activeVisualTheme.variant);
}

function captureVisualContextForRun() {
  if (!activeVisualTheme?.theme) return null;
  return {
    theme: activeVisualTheme.theme,
    variant: currentThemeDayNight(),
  };
}

function openLeaderboardReplay(row) {
  if (!replayViewer) {
    toast('Le lecteur de replay est encore en cours de chargement.');
    return;
  }

  audio.unlock('replay-open');
  void replayViewer.open(row);
}

function updateThemeDebugStatus() {
  const status = $('debug-theme-status');
  const variantRow = $('debug-variant-row');

  if (!status || !variantRow) {
    return;
  }

  variantRow.hidden = themeControls.mode === 'auto';
  const dayNight = currentThemeDayNight() === 'night' ? 'NUIT' : 'JOUR';
  const themeName = themeCatalog
    ? themeDefinition(activeVisualTheme, themeCatalog).label.toUpperCase()
    : activeVisualTheme.theme.toUpperCase();
  status.textContent = themeControls.mode === 'auto'
    ? `AUTO → ${themeName} · ${dayNight}`
    : `${themeName} · ${dayNight}`;
}

function populateThemeDebugOptions() {
  const select = $('debug-theme');
  if (!select || !themeCatalog) {
    return;
  }

  const requestedMode = themeControls.mode;
  select.replaceChildren();

  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = 'Auto';
  select.append(auto);

  // The debug list is intentionally data-driven: adding a theme to
  // assets/themes.json is enough to expose it here on the next load.
  for (const [id, definition] of themeEntries(themeCatalog)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = definition.label;
    select.append(option);
  }

  themeControls.mode = normalizeThemeMode(requestedMode, themeCatalog);
  select.value = themeControls.mode;
}

function applyVisualTheme(theme) {
  activeVisualTheme = theme;
  renderer?.setTheme(theme);
  updateThemeDebugStatus();

  if (renderer && game) {
    render();
  }
}

function resolveSelectedVisualTheme() {
  return resolveRunTheme({
    mode: themeControls.mode,
    variant: themeControls.variant,
    catalog: themeCatalog,
  });
}

function selectVisualThemeForMenu() {
  pendingVisualTheme = null;
  applyVisualTheme(resolveSelectedVisualTheme());
}

function prepareVisualThemeForRun() {
  pendingVisualTheme = resolveSelectedVisualTheme();
}

function activatePendingVisualTheme() {
  if (!pendingVisualTheme) {
    return;
  }

  const nextTheme = pendingVisualTheme;
  pendingVisualTheme = null;
  applyVisualTheme(nextTheme);
}

function setAtlasIcon(elementId, spriteName, scale) {
  const icon = $(elementId);
  const custom = renderer?.atlas?.custom;
  const sprite = custom?.sprites?.[spriteName];

  if (!icon || !custom || !sprite) {
    return;
  }

  const width = `${sprite.w * scale}px`;
  const height = `${sprite.h * scale}px`;
  const sourcePixel = `${scale}px`;

  icon.style.setProperty('--atlas-width', width);
  icon.style.setProperty('--atlas-height', height);
  icon.style.setProperty('--atlas-source-pixel', sourcePixel);
  icon.style.width = width;
  icon.style.height = height;
  icon.style.backgroundImage = `url("${custom.imageUrl}")`;
  icon.style.backgroundSize = `${custom.image.width * scale}px ${custom.image.height * scale}px`;
  icon.style.backgroundPosition = `-${sprite.x * scale}px -${sprite.y * scale}px`;
}

function setUtilityAtlasIcon(mode) {
  const spriteName = mode === 'home' ? 'button_home' : 'button_options';
  setAtlasIcon('utility-atlas-icon', spriteName, UTILITY_ATLAS_SCALE);
}

function setProfileAtlasIcon() {
  setAtlasIcon('profile-atlas-icon', 'button_profile', UTILITY_ATLAS_SCALE);
}

function setCloseAtlasIcons() {
  for (const id of ['close-options-icon', 'close-profile-icon', 'close-leaderboard-icon', 'close-replay-icon']) {
    setAtlasIcon(id, 'button_close', CLOSE_ATLAS_SCALE);
  }
}

function bindAtlasButtonAction(elementId, action) {
  const button = $(elementId);
  if (!button) {
    return;
  }

  let pressedAt = 0;
  let fallbackTimer = null;

  const releaseVisual = () => {
    button.classList.remove('atlas-pressed');
    pressedAt = 0;
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  };

  button.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    pressedAt = performance.now();
    button.classList.add('atlas-pressed');
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
    }
    fallbackTimer = window.setTimeout(releaseVisual, 500);
  });

  button.addEventListener('pointercancel', releaseVisual);

  button.addEventListener('click', event => {
    if (!pressedAt) {
      pressedAt = performance.now();
      button.classList.add('atlas-pressed');
    }

    const elapsed = performance.now() - pressedAt;
    const remaining = Math.max(0, ATLAS_PRESS_MIN_MS - elapsed);
    window.setTimeout(() => {
      releaseVisual();
      action(event);
    }, remaining);
  });
}

function syncUtilityVisibility() {
  const button = $('open-options');
  const profileButton = $('open-profile');
  const state = game?.state ?? 'MENU';
  const mode = state === 'MENU'
    ? 'options'
    : state === 'READY' || state === 'GAME_OVER'
      ? 'home'
      : 'hidden';
  const fadeReady = game?.fade?.done ?? true;
  const modalOpen = options.open || profileDialog.open || leaderboardDialog.open || unrankedWarning.open;
  const menuVisible = mode === 'options' && fadeReady && game?.fadeEvent !== 5 && !modalOpen;
  const mainVisible = mode !== 'hidden'
    && fadeReady
    && !modalOpen
    && (mode !== 'options' || game?.fadeEvent !== 5);
  const profileVisible = state === 'MENU' && menuVisible;
  const signature = `${mode}:${profileVisible}:${modalOpen}:${game?.fadeEvent ?? 0}:${fadeReady}`;

  if (signature === lastUtilityVisibility) {
    return;
  }

  lastUtilityVisibility = signature;
  button.hidden = !mainVisible;
  profileButton.hidden = !profileVisible;
  button.dataset.mode = mode;
  button.title = mode === 'home' ? 'Retour à l’accueil' : 'Options (Echap)';
  button.setAttribute(
    'aria-label',
    mode === 'home' ? 'Retourner à l’écran d’accueil' : 'Ouvrir les options',
  );
  setUtilityAtlasIcon(mode);
  if (profileVisible) {
    setProfileAtlasIcon();
  }
}

function returnToHome() {
  const state = game?.state;

  if (!game || !['READY', 'GAME_OVER'].includes(state) || !game.fade.done) {
    return;
  }

  void verifiedPlay.abandon({ reason: 'home-from-ready-or-game-over' });

  audio.note('HOME_NAVIGATION', { from: state });
  clearInput();
  game.transition(true, 6, 0.25);
  syncUtilityVisibility();
  clock.reset();
}

function openOptions() {
  if (!game) {
    return;
  }

  audio.note('SETTINGS_OPEN');
  audio.unlock('settings-open');
  if (!options.open) {
    options.showModal();
  }

  syncUtilityVisibility();
  clearInput();
  clock.reset();
  void pwaManager.checkForUpdates({ silent: true, reason: 'options-open' });
}

function openProfile() {
  if (!game || game.state !== 'MENU' || !(game.fade?.done ?? true)) {
    return;
  }

  audio.note('PROFILE_OPEN');
  audio.unlock('profile-open');
  accountUI.render(auth.snapshot());
  if (navigator.onLine && auth.snapshot().user) void auth.sync({ reason: 'profile-open' });
  if (!profileDialog.open) {
    profileDialog.showModal();
  }

  syncUtilityVisibility();
  clearInput();
  clock.reset();
}

function closeProfile() {
  if (profileDialog.open) {
    profileDialog.close();
  }
}

function openLeaderboard({ force = false } = {}) {
  if (!game) {
    return;
  }

  audio.note('LEADERBOARD_OPEN');
  audio.unlock('leaderboard-open');

  if (options.open) {
    options.close();
  }

  leaderboardUI.render();
  if (!leaderboardDialog.open) {
    leaderboardDialog.showModal();
  }

  syncUtilityVisibility();
  clearInput();
  clock.reset();
  void leaderboardUI.refreshAll({ force });
}

function closeLeaderboard() {
  if (leaderboardDialog.open) {
    leaderboardDialog.close();
  }
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

let canvasRect = canvas.getBoundingClientRect();

function updateCanvasRect() {
  canvasRect = canvas.getBoundingClientRect();
}

function pointerPosition(event) {
  const rect = canvasRect;
  const cssScale = rect.width / LOGICAL_WIDTH || 1;

  return {
    x: Math.trunc((event.clientX - rect.left) / cssScale),
    y: Math.trunc(
      (event.clientY - rect.top) / cssScale - displayLayout.topPad,
    ),
  };
}

function press(id, point) {
  if (!game || options.open || profileDialog.open || leaderboardDialog.open || unrankedWarning.open || verifiedPlay.startPending) {
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

  if (event.pointerType !== 'touch') {
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
  }

  press(event.pointerId, pointerPosition(event));
});

canvas.addEventListener('pointerup', event => {
  if (event.pointerType !== 'touch') {
    event.preventDefault();
  }
  release(event.pointerId);
});

canvas.addEventListener('pointercancel', event => {
  touchRecords.delete(event.pointerId);
});

canvas.addEventListener('contextmenu', event => {
  event.preventDefault();
});

window.addEventListener('keydown', event => {
  if (options.open || profileDialog.open || leaderboardDialog.open || unrankedWarning.open || verifiedPlay.startPending) {
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

  if (pwaManager.registration && navigator.onLine) {
    void pwaManager.checkForUpdates({ silent: true, reason: 'pageshow' });
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

    if (pwaManager.registration && navigator.onLine) {
      void pwaManager.checkForUpdates({ silent: true, reason: 'foreground' });
    }
  }
});

window.addEventListener('resize', scheduleResize);
window.visualViewport?.addEventListener('resize', scheduleResize);
new ResizeObserver(updateCanvasRect).observe(canvas);
window.addEventListener('orientationchange', updateOrientationGuard);
screen.orientation?.addEventListener?.('change', updateOrientationGuard);

bindAtlasButtonAction('open-options', () => {
  if (game?.state === 'READY' || game?.state === 'GAME_OVER') {
    returnToHome();
  } else {
    openOptions();
  }
});
bindAtlasButtonAction('open-profile', openProfile);
bindAtlasButtonAction('close-options', closeOptions);
bindAtlasButtonAction('close-profile', closeProfile);
bindAtlasButtonAction('close-leaderboard', closeLeaderboard);

profileDialog.addEventListener('close', () => {
  audio.note('PROFILE_DIALOG_CLOSED');
  syncUtilityVisibility();
  clearInput();
  clock.reset();
  canvas.focus({ preventScroll: true });
});

profileDialog.addEventListener('cancel', event => {
  event.preventDefault();
  closeProfile();
});

leaderboardDialog.addEventListener('close', () => {
  audio.note('LEADERBOARD_DIALOG_CLOSED');
  syncUtilityVisibility();
  clearInput();
  clock.reset();
  canvas.focus({ preventScroll: true });
});

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

$('debug-close').onclick = () => {
  setDebug(false);
};

$('debug-theme').onchange = () => {
  themeControls.mode = $('debug-theme').value;
  selectVisualThemeForMenu();
};

$('debug-theme-variant').onchange = () => {
  themeControls.variant = $('debug-theme-variant').value;
  if (themeControls.mode !== 'auto') {
    selectVisualThemeForMenu();
  }
  updateThemeDebugStatus();
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

  verifiedPlay.interceptPlay(game, input);

  verifiedPlay.beforeTick(game, input);

  const signature = JSON.stringify(input);

  if (input.tap || signature !== lastInputSignature) {
    if (trace.length < MAX_REPLAY_INPUTS) {
      trace.push({
        frame: game.frame + 1,
        touches: input.touches.map(({ x, y }) => ({ x, y })),
        tap: input.tap ? { x: input.tap.x, y: input.tap.y } : null,
      });
    } else {
      droppedReplay = true;
    }

    lastInputSignature = signature;
  }

  const stateBeforeTick = game.state;
  game.tick(input);

  if (stateBeforeTick !== 'READY' && game.state === 'READY') {
    activatePendingVisualTheme();
  } else if (debug) {
    updateThemeDebugStatus();
  }

  verifiedPlay.afterTick(game);

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
      leaderboardOpen: leaderboardDialog.open,
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
    !leaderboardDialog.open &&
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
    seed: game.seed,
    bestAtBoot: bootBest,
    totalFrames: game.frame,
    truncated: droppedReplay,
    inputs: structuredClone(trace),
    final: game.snapshot(),
  };
}

function exportReplay() {
  downloadJson(
    `flappy13-${game.seed}-${game.frame}.json`,
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
});

$('refresh-cache').onclick = () => {
  void pwaManager.action();
};

window.addEventListener('online', () => {
  audio.note('NETWORK_ONLINE');
  auth.sync({ reason: 'online' }).then(async state => {
    if (state.status === 'signed_in') {
      await scoreSync.sync({ reason: 'online' });
      await verifiedPlay.flush({ reason: 'online', notify: true });
    }
  });

  if (leaderboardDialog.open) {
    void leaderboardUI.refreshAll({ force: true });
  } else {
    leaderboardUI.render();
  }

  void pwaManager.checkForUpdates({ silent: true, reason: 'online' });
});

window.addEventListener('offline', () => {
  audio.note('NETWORK_OFFLINE');
  scoreSync.setOffline(Boolean(auth.session));
  const offlineState = {
    ...auth.snapshot(),
    status: auth.session ? 'offline' : 'signed_out',
  };
  accountUI.render(offlineState);
  leaderboardUI.render(offlineState);
  pwaManager.noteOffline();
});

async function boot() {
  try {
    if (location.protocol === 'file:') {
      throw new Error(
        'Servez le dossier site/ via HTTP(S). Le jeu ne peut pas être lancé directement en file://.',
      );
    }

    const authInit = auth.init().catch(error => ({ status: 'error', error: error.message }));
    const [atlas] = await Promise.all([
      loadAtlas(),
      audio.preload(),
    ]);

    themeCatalog = atlas.themes;
    renderer = new Renderer(canvas, atlas);
    replayViewer = new ReplayViewer({
      dialog: replayDialog,
      canvas: $('replay-canvas'),
      client: leaderboardClient,
      atlas,
      audio,
      getElement: $,
      toast,
    });
    game = new Game({
      seed,
      best,
      onEvent: handleGameEvent,
    });
    populateThemeDebugOptions();
    $('debug-theme-variant').value = themeControls.variant;
    selectVisualThemeForMenu();
    setUtilityAtlasIcon('options');
    setProfileAtlasIcon();
    setCloseAtlasIcons();

    $('loading').hidden = true;
    setDebug(debug);
    updateOrientationGuard();
    resize();
    tick({ touches: [] });
    cachedDebugState = debug ? game.snapshot() : null;
    render();
    tryLockPortrait();
    requestAnimationFrame(animate);

    authInit.then(async state => {
      accountUI.render(auth.snapshot());
      const callbackIsSignIn = auth.callbackResult === 'signed_in';
      const callbackIsLink = auth.callbackResult === 'identity_linked';
      const callbackReason = callbackIsLink ? 'identity-link' : callbackIsSignIn ? 'oauth-login' : 'startup';

      if (state.status === 'signed_in') {
        await scoreSync.sync({
          reason: callbackReason,
          notify: callbackIsSignIn || callbackIsLink,
        });
        await verifiedPlay.flush({
          reason: callbackReason,
          notify: true,
        });
      }

      if (callbackIsSignIn) {
        openProfile();
      } else if (callbackIsLink) {
        openProfile();
        toast(`${providerLabel(auth.callbackProvider)} est maintenant lié à ce profil.`);
      } else if (auth.callbackResult === 'identity_link_error') {
        openProfile();
        const label = providerLabel(auth.callbackProvider);
        const message = String(auth.error || 'erreur OAuth');
        toast(
          /already.*linked|identity.*exists|already.*registered/i.test(message)
            ? `Ce compte ${label} est déjà lié à un autre profil. Aucun compte n’a été fusionné ou remplacé.`
            : `Impossible de lier ${label} : ${message}`,
          7000,
        );
      } else if (auth.callbackResult === 'error') {
        toast(`Connexion impossible : ${auth.error || 'erreur OAuth'}`);
      }
    });

    // Explicit diagnostics API. Ordinary controls do not expose gameplay cheats.
    window.flappy = {
      version: VERSION,
      get game() {
        return game;
      },
      get audio() {
        return audio;
      },
      auth: () => auth.snapshot(),
      leaderboard: () => structuredClone(leaderboardUI.rows),
      leaderboardContext: () => structuredClone(leaderboardUI.context),
      playerPerformance: () => structuredClone(leaderboardUI.performance),
      openProfile,
      closeProfile,
      openLeaderboard: () => openLeaderboard({ force: true }),
      closeLeaderboard,
      refreshLeaderboard: () => leaderboardUI.refreshAll({ force: true }),
      verifiedRun: () => verifiedPlay.snapshot(),
      theme: () => structuredClone({ controls: themeControls, active: activeVisualTheme }),
      pendingVerifiedRuns: () => verifiedPlay.pendingRuns(),
      flushVerifiedRuns: () => verifiedPlay.flush({ reason: 'diagnostic', notify: true }),
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
      cache: () => pwaManager.cacheInfo,
      checkOffline: () => pwaManager.checkOffline(),
      checkForUpdates: options => pwaManager.checkForUpdates(options),
      installPendingUpdate: options => pwaManager.installPendingUpdate(options),
      checkUpdateSource: options => pwaManager.checkForUpdates(options),
      flushCacheAndUpdate: options => pwaManager.installPendingUpdate(options),
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

    pwaManager.setup().catch(error => {
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
