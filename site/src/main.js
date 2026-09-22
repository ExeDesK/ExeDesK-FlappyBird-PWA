import { Renderer, loadAtlas } from './atlas.js';
import { Audio } from './audio.js';
import { AuthClient } from './auth.js';
import { FixedClock } from './clock.js';
import {
  LOGICAL_WIDTH,
  computeDisplaySize,
  defaultAspectForCapabilities,
  renderQualityScale,
} from './display.js';
import { Game } from './game.js';
import { leaderboardName } from './leaderboard.js';
import { PerfProfiler } from './perf.js';
import {
  effectiveDayNight,
  resolveRunTheme,
  themeDefinition,
  themeEntries,
} from './themes.js';
import {
  VerifiedRunRecorder,
  enqueueVerifiedRun,
  isPlayRelease,
  pendingVerifiedRuns as readPendingVerifiedRuns,
  pendingVerifiedRunsForPlayer,
  removePendingVerifiedRun,
  shouldDiscardVerifiedRunSubmission,
  verifiedRunStartMode,
} from './verified-run-client.js';
import { createCanonicalRunGame } from './verified-runs.js';

const VERSION = '0.2.7.3b-dev6.3.2';
const BEST_SCORE_KEY = 'flappy13-personal-best-v1';
const SETTINGS_KEY = 'flappy13-settings-v1';
const LAST_VERSION_KEY = 'flappy13-last-version-v1';
const runtimeConfig = globalThis.FLAPPY_CONFIG && typeof globalThis.FLAPPY_CONFIG === 'object'
  ? globalThis.FLAPPY_CONFIG
  : {};
const SUPABASE_URL = typeof runtimeConfig.supabaseUrl === 'string'
  ? runtimeConfig.supabaseUrl
  : '';
const SUPABASE_PUBLISHABLE_KEY = typeof runtimeConfig.supabasePublishableKey === 'string'
  ? runtimeConfig.supabasePublishableKey
  : '';
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const UPDATE_PROBE_TIMEOUT_MS = 3500;
const MAX_REPLAY_INPUTS = 30000;
const PLAY_FADE_SECONDS = 0.5;
const PLAY_FADE_MIN_MS = PLAY_FADE_SECONDS * 1000;
const UTILITY_ATLAS_SCALE = 2;

const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);

const canvas = $('game');
const stage = $('stage');
const options = $('options');
const leaderboardDialog = $('leaderboard-dialog');
const unrankedWarning = $('unranked-warning');
const audio = new Audio({ version: VERSION });
const auth = new AuthClient({
  url: SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
});
const clock = new FixedClock(60);
const profiler = new PerfProfiler(10000);

let game;
let renderer;
let themeCatalog = null;
let paused = false;
let debug = false;
let themeControls = { mode: 'auto', variant: 'day' };
let activeVisualTheme = { mode: 'auto', theme: 'original', variant: 'auto' };
let pendingVisualTheme = null;
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
let scoreSyncState = 'local';
let scoreSyncError = null;
let scoreSyncPromise = null;
let scoreSyncDirty = false;
let verifiedStartPending = false;
let allowUnrankedPlayOnce = false;
let verifiedRunRecorder = null;
let lastVerifiedRun = null;
let unrankedWarningResolver = null;
let verifiedQueueFlushPromise = null;
let leaderboardRows = [];
let leaderboardState = 'idle';
let leaderboardPromise = null;
let leaderboardLoadedAt = 0;
let leaderboardContext = null;
let leaderboardContextState = 'idle';
let leaderboardContextPromise = null;
let leaderboardContextLoadedAt = 0;
let leaderboardContextPlayerId = null;
let playerPerformanceStats = null;
let playerPerformanceState = 'idle';
let playerPerformancePromise = null;
let playerPerformanceLoadedAt = 0;
let playerPerformancePlayerId = null;
const LEADERBOARD_STALE_MS = 60 * 1000;

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

function hideToast() {
  const node = $('toast');

  if (typeof node.hidePopover === 'function' && node.matches(':popover-open')) {
    node.hidePopover();
  } else {
    node.hidden = true;
  }
}

function toast(text, ms = 4500) {
  const node = $('toast');
  node.textContent = text;
  clearTimeout(toastTimer);

  // Popovers live in the browser top layer, above modal <dialog> elements.
  if (typeof node.showPopover === 'function') {
    if (node.matches(':popover-open')) {
      node.hidePopover();
    }

    node.hidden = false;
    node.showPopover();
  } else {
    node.hidden = false;
  }

  toastTimer = setTimeout(hideToast, ms);
}

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

  $('best-score').textContent = best;
  return best !== previous;
}

function saveBest(value) {
  const changed = applyBest(value);
  if (changed) {
    syncBestWithCloud({ reason: 'new-record' });
  }
}

function handleGameEvent({ type, value }) {
  if (type === 'sound') {
    audio.play(value);
  } else if (type === 'record' && !verifiedRunRecorder) {
    // Ranked runs update persistent scores only after run-submit has replayed
    // them authoritatively. The Game may still render its in-run panel value.
    saveBest(value);
  } else if (type === 'local-scores') {
    openLeaderboard({ force: true });
  } else if (type === 'about') {
    openOptions();
  }
}

function settleUnrankedWarning(continueLocally) {
  const resolve = unrankedWarningResolver;
  unrankedWarningResolver = null;

  if (unrankedWarning.open) {
    unrankedWarning.close();
  }

  resolve?.(continueLocally);
}

function askToPlayUnranked(message) {
  if (unrankedWarningResolver) {
    settleUnrankedWarning(false);
  }

  $('unranked-warning-message').textContent = message;
  clearInput();
  clock.reset();

  return new Promise(resolve => {
    unrankedWarningResolver = resolve;
    unrankedWarning.showModal();
    $('unranked-continue').focus();
  });
}

$('unranked-continue').onclick = () => settleUnrankedWarning(true);
$('unranked-cancel').onclick = () => settleUnrankedWarning(false);
unrankedWarning.addEventListener('cancel', event => {
  event.preventDefault();
  settleUnrankedWarning(false);
});

function installVerifiedGame(ticket) {
  const prepared = createCanonicalRunGame({
    seed: ticket.seed,
    best,
    onEvent: handleGameEvent,
  });

  game = prepared.game;
  verifiedRunRecorder = new VerifiedRunRecorder(ticket);
  lastVerifiedRun = {
    status: 'ready',
    run_id: ticket.run_id,
    physics_version: ticket.physics_version,
    warmup_frames: prepared.warmupFrames,
  };

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

  console.info('[Verified Runs] Partie classée prête.', {
    run_id: ticket.run_id,
    physics_version: ticket.physics_version,
  });
}

function queueVerifiedSubmission(submission) {
  try {
    const playerId = auth.user?.id || auth.profile?.id || null;
    const pending = enqueueVerifiedRun(submission, { playerId });
    lastVerifiedRun = {
      status: 'queued',
      run_id: submission.run_id,
      terminal_tick: submission.terminal_tick,
      tap_count: submission.taps.length,
      pending,
    };
    console.info('[Verified Runs] Replay enregistré pour soumission.', lastVerifiedRun);

    if (navigator.onLine && auth.session) {
      void flushVerifiedRunQueue({ reason: 'run-finished', notify: true });
    } else {
      toast('Pas d’internet · envoi reporté. Le run reste conservé sur cet appareil.', 6000);
    }
  } catch (error) {
    lastVerifiedRun = {
      status: 'queue-error',
      run_id: submission.run_id,
      error: String(error?.message || error),
    };
    console.error('[Verified Runs] Enregistrement local impossible.', error);
    toast('Impossible d’enregistrer ce run classé sur cet appareil.', 6000);
  }
}

async function flushVerifiedRunQueue({ reason = 'manual', notify = false } = {}) {
  if (verifiedQueueFlushPromise) {
    return verifiedQueueFlushPromise;
  }

  const playerId = auth.user?.id || auth.profile?.id;
  if (!auth.session || !playerId || !navigator.onLine) {
    return { verified: 0, rejected: 0, discarded: 0, deferred: true };
  }

  verifiedQueueFlushPromise = (async () => {
    let verified = 0;
    let rejected = 0;
    let discarded = 0;
    let deferred = false;
    let highestVerifiedScore = -1;
    let lastResult = null;
    const queue = pendingVerifiedRunsForPlayer(playerId);

    for (const item of queue) {
      const submission = item?.submission;
      if (!submission?.run_id) {
        continue;
      }

      try {
        const result = await auth.submitVerifiedRun(submission);
        removePendingVerifiedRun(submission.run_id);
        lastResult = result;

        if (result.status === 'verified') {
          verified++;
          highestVerifiedScore = Math.max(highestVerifiedScore, result.score);
        } else {
          rejected++;
        }
      } catch (error) {
        if (shouldDiscardVerifiedRunSubmission(error)) {
          removePendingVerifiedRun(submission.run_id);
          discarded++;
          console.warn('[Verified Runs] Soumission locale abandonnée.', {
            run_id: submission.run_id,
            status: error?.status,
            code: error?.code,
          });
          continue;
        }

        deferred = true;
        console.warn('[Verified Runs] Soumission différée.', {
          run_id: submission.run_id,
          reason,
          status: error?.status,
          code: error?.code,
          message: error?.message,
        });
        break;
      }
    }

    if (highestVerifiedScore >= 0) {
      saveBest(highestVerifiedScore);
      leaderboardLoadedAt = 0;
      leaderboardContextLoadedAt = 0;
      playerPerformanceLoadedAt = 0;
      if (leaderboardDialog.open && navigator.onLine) {
        void loadLeaderboard({ force: true });
        void loadLeaderboardContext({ force: true });
        void loadPlayerPerformanceStats({ force: true });
      }
    }

    if (lastResult) {
      lastVerifiedRun = {
        status: lastResult.status,
        run_id: lastResult.run_id,
        score: lastResult.score,
        collision: lastResult.collision,
        rejection_code: lastResult.rejection_code,
        resolved_at: lastResult.resolved_at,
        idempotent: lastResult.idempotent,
      };
    }

    console.info('[Verified Runs] File de soumission traitée.', {
      reason,
      verified,
      rejected,
      discarded,
      deferred,
    });

    if (notify) {
      if (rejected > 0) {
        toast(
          rejected === 1
            ? 'Run rejeté par la vérification serveur.'
            : `${rejected} runs rejetés par la vérification serveur.`,
          6000,
        );
      } else if (discarded > 0) {
        toast('Une ancienne soumission incompatible a été retirée.', 6000);
      } else if (deferred) {
        toast('Pas d’internet · envoi reporté. Le run reste conservé sur cet appareil.', 6000);
      }
    }

    return { verified, rejected, discarded, deferred };
  })().finally(() => {
    verifiedQueueFlushPromise = null;
  });

  return verifiedQueueFlushPromise;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForPlayFadeToBlack(originGame, startedAt) {
  while (
    game === originGame
    && (
      performance.now() - startedAt < PLAY_FADE_MIN_MS
      || !originGame.fade.done
      || originGame.fade.value < 1
    )
  ) {
    await sleep(16);
  }

  return game === originGame;
}

async function ensureVerifiedPlayFadeToBlack(originGame, startedAt = null) {
  let effectiveStartedAt = startedAt;

  // PLAY can be pressed while another menu fade is still completing. Never
  // wait for a black value unless we have actually started the PLAY fade.
  while (game === originGame && effectiveStartedAt == null) {
    if (originGame.fade.done) {
      effectiveStartedAt = startVerifiedPlayFade(originGame);
      break;
    }

    await sleep(16);
  }

  if (game !== originGame || effectiveStartedAt == null) {
    return false;
  }

  return waitForPlayFadeToBlack(originGame, effectiveStartedAt);
}

function startVerifiedPlayFade(originGame) {
  if (!originGame?.fade?.done) {
    return null;
  }

  const startedAt = performance.now();
  originGame.transition(true, 0, PLAY_FADE_SECONDS);
  audio.play('swooshing');
  syncUtilityVisibility();
  clock.reset();
  return startedAt;
}

function restoreMenuFromBlack(originGame) {
  if (game !== originGame) {
    return;
  }

  if (originGame.fade.done && originGame.fade.value > 0) {
    originGame.transition(false, 0, PLAY_FADE_SECONDS);
  }

  syncUtilityVisibility();
  clock.reset();
}

function startUnrankedFromBlack(originGame) {
  if (game !== originGame) {
    return;
  }

  verifiedRunRecorder = null;
  activatePendingVisualTheme();
  originGame.event(5);
  syncUtilityVisibility();
  clock.reset();
}

async function beginAuthenticatedPlay(originGame, mode, fadeStartedAt = null) {
  if (verifiedStartPending) {
    return;
  }

  verifiedStartPending = true;

  try {
    if (mode === 'warn-offline') {
      const proceed = await askToPlayUnranked(
        'Vous êtes connecté à Discord, mais l’application est hors ligne. '
        + 'Cette partie ne pourra pas être comptabilisée dans le classement.',
      );

      if (proceed && game === originGame && originGame.play.active) {
        verifiedRunRecorder = null;
        allowUnrankedPlayOnce = true;
        originGame.play.pressed = true;
      } else {
        pendingVisualTheme = null;
      }
      return;
    }

    const fadePromise = ensureVerifiedPlayFadeToBlack(originGame, fadeStartedAt);

    try {
      const ticketPromise = auth.startVerifiedRun();
      const [ticket, stillCurrent] = await Promise.all([ticketPromise, fadePromise]);

      if (stillCurrent && game === originGame && originGame.play.active) {
        installVerifiedGame(ticket);
      }
    } catch (error) {
      console.warn('[Verified Runs] Ticket indisponible.', error);

      await fadePromise;

      const proceed = await askToPlayUnranked(
        `Impossible de préparer la partie classée : ${error?.message || error}. `
        + 'Vous pouvez continuer, mais cette partie ne sera pas comptabilisée.',
      );

      if (proceed && game === originGame && originGame.play.active) {
        startUnrankedFromBlack(originGame);
      } else {
        pendingVisualTheme = null;
        restoreMenuFromBlack(originGame);
      }
    }
  } finally {
    verifiedStartPending = false;
    clock.reset();
  }
}

function scoreSyncAvailable(state = auth.snapshot()) {
  return Boolean(state.user || state.profile)
    && state.status === 'signed_in'
    && navigator.onLine;
}

async function syncBestWithCloud({ reason = 'manual', notify = false } = {}) {
  const state = auth.snapshot();

  if (!scoreSyncAvailable(state)) {
    scoreSyncState = state.status === 'offline' || !navigator.onLine ? 'offline' : 'local';
    scoreSyncError = null;
    renderAccount(state);
    return best;
  }

  // A new record can arrive while an RPC is already in flight. Mark the
  // current operation dirty and let it perform one more atomic max merge.
  if (scoreSyncPromise) {
    scoreSyncDirty = true;
    return scoreSyncPromise;
  }

  const beforeSync = best;
  scoreSyncState = 'syncing';
  scoreSyncError = null;
  renderAccount(state);

  scoreSyncPromise = (async () => {
    try {
      let merged = best;
      do {
        scoreSyncDirty = false;
        merged = await auth.syncBestScore(best);
        applyBest(merged);
        if (best > merged) {
          scoreSyncDirty = true;
        }
      } while (scoreSyncDirty);

      scoreSyncState = 'synced';
      scoreSyncError = null;
      renderAccount(auth.snapshot());

      return best;
    } catch (error) {
      scoreSyncState = navigator.onLine ? 'error' : 'offline';
      scoreSyncError = String(error?.message || error);
      renderAccount(auth.snapshot());
      return best;
    } finally {
      scoreSyncPromise = null;
    }
  })();

  return scoreSyncPromise;
}

function leaderboardSignedIn(state = auth.snapshot()) {
  return Boolean(state.user || state.profile)
    && ['signed_in', 'offline', 'loading'].includes(state.status);
}

function currentLeaderboardPlayerId(state = auth.snapshot()) {
  return state.user?.id || state.profile?.id || null;
}

function formatLeaderboardDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function resetLeaderboardContext(playerId = null) {
  leaderboardContext = null;
  leaderboardContextState = 'idle';
  leaderboardContextPromise = null;
  leaderboardContextLoadedAt = 0;
  leaderboardContextPlayerId = playerId;
}

function renderLeaderboardContext(state = auth.snapshot()) {
  const card = $('leaderboard-player-card');
  const status = $('leaderboard-player-status');
  const rank = $('leaderboard-player-rank');
  const bestScore = $('leaderboard-player-best');
  const runs = $('leaderboard-player-runs');
  const recordDate = $('leaderboard-player-record-date');
  const signedIn = leaderboardSignedIn(state);
  const currentPlayerId = currentLeaderboardPlayerId(state);
  const hasContext = Boolean(
    leaderboardContext
    && currentPlayerId
    && leaderboardContext.player_id === currentPlayerId,
  );

  card.hidden = !signedIn;
  if (!signedIn) {
    return;
  }

  rank.textContent = '—';
  bestScore.textContent = '—';
  runs.textContent = '—';
  recordDate.textContent = 'Chargement de vos statistiques vérifiées...';

  if (!auth.configured) {
    status.textContent = 'INDISPONIBLE';
    recordDate.textContent = 'Statistiques personnelles indisponibles sur cette build.';
    return;
  }

  if (!navigator.onLine && !hasContext) {
    status.textContent = 'HORS CONNEXION';
    recordDate.textContent = 'Vos statistiques seront chargées au retour du réseau.';
    return;
  }

  if (leaderboardContextState === 'loading' && !hasContext) {
    status.textContent = 'CHARGEMENT...';
    return;
  }

  if (leaderboardContextState === 'error' && !hasContext) {
    status.textContent = 'INDISPONIBLE';
    recordDate.textContent = 'Impossible de charger votre classement pour le moment.';
    return;
  }

  if (!hasContext) {
    status.textContent = 'EN ATTENTE';
    return;
  }

  const count = leaderboardContext.verified_runs_count;
  runs.textContent = String(count);

  if (count === 0) {
    status.textContent = 'PAS ENCORE CLASSÉ';
    recordDate.textContent = 'Terminez une run vérifiée pour entrer dans le classement.';
    return;
  }

  rank.textContent = `#${leaderboardContext.global_rank}`;
  bestScore.textContent = String(leaderboardContext.best_score);
  status.textContent = navigator.onLine ? 'RUNS VÉRIFIÉS' : 'DERNIÈRE LECTURE';
  recordDate.textContent = `Record · ${formatLeaderboardDate(leaderboardContext.best_score_at)}`;
}

function resetPlayerPerformanceStats(playerId = null) {
  playerPerformanceStats = null;
  playerPerformanceState = 'idle';
  playerPerformancePromise = null;
  playerPerformanceLoadedAt = 0;
  playerPerformancePlayerId = playerId;
}

function formatStat(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(digits).replace(/\.0$/, '');
}

function renderPlayerPerformanceStats(state = auth.snapshot()) {
  const card = $('leaderboard-stats-card');
  const status = $('leaderboard-stats-status');
  const playerId = currentLeaderboardPlayerId(state);
  const signedIn = leaderboardSignedIn(state);
  const hasStats = Boolean(playerPerformanceStats && playerPerformanceStats.player_id === playerId);
  card.hidden = !signedIn;
  if (!signedIn) return;

  const ids = [
    'stats-career-average','stats-total-score','stats-trend',
    'stats-10-average','stats-10-best','stats-10-median','stats-10-regularity',
    'stats-25-average','stats-25-best','stats-25-median','stats-25-regularity',
    'stats-50-average','stats-50-best','stats-50-median','stats-50-regularity',
  ];
  for (const id of ids) $(id).textContent = '—';

  if (playerPerformanceState === 'loading' && !hasStats) { status.textContent = 'CHARGEMENT...'; return; }
  if (playerPerformanceState === 'error' && !hasStats) { status.textContent = 'INDISPONIBLE'; return; }
  if (!hasStats) { status.textContent = 'EN ATTENTE'; return; }

  status.textContent = navigator.onLine ? 'RUNS VÉRIFIÉS' : 'DERNIÈRE LECTURE';
  $('stats-career-average').textContent = formatStat(playerPerformanceStats.career_average);
  $('stats-total-score').textContent = String(playerPerformanceStats.total_score);
  const trend = playerPerformanceStats.recent_50_vs_career_pct;
  $('stats-trend').textContent = trend == null ? '—' : `${trend >= 0 ? '+' : ''}${formatStat(trend)}%`;

  for (const size of [10, 25, 50]) {
    const windowStats = playerPerformanceStats[`recent_${size}`];
    $(`stats-${size}-average`).textContent = formatStat(windowStats.average);
    $(`stats-${size}-best`).textContent = windowStats.best == null ? '—' : String(windowStats.best);
    $(`stats-${size}-median`).textContent = formatStat(windowStats.median);
    $(`stats-${size}-regularity`).textContent = formatStat(windowStats.stddev);
  }
}

function renderLeaderboard(state = auth.snapshot()) {
  const list = $('leaderboard-list');
  const empty = $('leaderboard-empty');
  const status = $('leaderboard-status');
  const refresh = $('refresh-leaderboard');
  const currentPlayerId = currentLeaderboardPlayerId(state);

  $('leaderboard-login-hint').hidden = leaderboardSignedIn(state);
  refresh.disabled = !auth.configured || !navigator.onLine || leaderboardState === 'loading';
  renderLeaderboardContext(state);
  renderPlayerPerformanceStats(state);

  if (!auth.configured) {
    status.textContent = 'Classement indisponible sur cette build.';
  } else if (!navigator.onLine) {
    status.textContent = 'Classement indisponible hors connexion.';
  } else if (leaderboardState === 'loading') {
    status.textContent = 'Chargement du classement...';
  } else if (leaderboardState === 'error') {
    status.textContent = 'Classement indisponible pour le moment.';
  } else if (leaderboardState === 'loaded') {
    status.textContent = leaderboardRows.length
      ? `Top ${leaderboardRows.length} · meilleur score vérifié par joueur.`
      : 'Aucun score vérifié pour le moment.';
  } else {
    status.textContent = 'Classement public des runs vérifiés.';
  }

  list.replaceChildren();
  for (const row of leaderboardRows) {
    const item = document.createElement('li');
    item.className = 'leaderboard-row';
    if (currentPlayerId && row.player_id === currentPlayerId) {
      item.classList.add('is-current-player');
    }

    const rank = document.createElement('strong');
    rank.className = 'leaderboard-rank';
    rank.textContent = `#${row.rank}`;

    const avatarWrap = document.createElement('span');
    avatarWrap.className = 'leaderboard-avatar-wrap';
    const fallback = document.createElement('span');
    fallback.className = 'leaderboard-avatar-fallback';
    fallback.textContent = leaderboardName(row).slice(0, 1).toUpperCase() || '?';
    avatarWrap.append(fallback);

    if (row.avatar_url) {
      const image = document.createElement('img');
      image.className = 'leaderboard-avatar';
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.src = row.avatar_url;
      image.addEventListener('load', () => {
        fallback.hidden = true;
      });
      image.addEventListener('error', () => {
        image.remove();
        fallback.hidden = false;
      });
      avatarWrap.prepend(image);
    }

    const identity = document.createElement('span');
    identity.className = 'leaderboard-identity';
    const name = document.createElement('strong');
    name.textContent = leaderboardName(row);
    identity.append(name);
    if (row.username) {
      const username = document.createElement('span');
      username.textContent = `@${row.username}`;
      identity.append(username);
    }

    const score = document.createElement('strong');
    score.className = 'leaderboard-score';
    score.textContent = String(row.score);

    item.append(rank, avatarWrap, identity, score);
    list.append(item);
  }

  empty.hidden = leaderboardRows.length > 0 || leaderboardState !== 'loaded';
}

async function loadLeaderboard({ force = false, notify = false } = {}) {
  if (leaderboardPromise) {
    return leaderboardPromise;
  }

  if (!auth.configured || !navigator.onLine) {
    leaderboardState = 'error';
    renderLeaderboard();
    return leaderboardRows;
  }

  if (
    !force
    && leaderboardState === 'loaded'
    && Date.now() - leaderboardLoadedAt < LEADERBOARD_STALE_MS
  ) {
    renderLeaderboard();
    return leaderboardRows;
  }

  leaderboardState = 'loading';
  renderLeaderboard();

  leaderboardPromise = (async () => {
    try {
      leaderboardRows = await auth.fetchLeaderboard({ limit: 100 });
      leaderboardState = 'loaded';
      leaderboardLoadedAt = Date.now();
      return leaderboardRows;
    } catch (error) {
      leaderboardState = 'error';
      console.warn('[Leaderboard] Chargement impossible.', error);
      if (notify) {
        toast('Impossible d’actualiser le classement.');
      }
      return leaderboardRows;
    } finally {
      leaderboardPromise = null;
      renderLeaderboard();
    }
  })();

  return leaderboardPromise;
}

async function loadLeaderboardContext({ force = false } = {}) {
  const state = auth.snapshot();
  const playerId = currentLeaderboardPlayerId(state);

  if (!leaderboardSignedIn(state) || !auth.session || !playerId) {
    resetLeaderboardContext(null);
    renderLeaderboard(state);
    return null;
  }

  if (leaderboardContextPlayerId !== playerId) {
    resetLeaderboardContext(playerId);
  }

  if (leaderboardContextPromise) {
    return leaderboardContextPromise;
  }

  if (!auth.configured || !navigator.onLine) {
    if (!leaderboardContext) {
      leaderboardContextState = 'error';
    }
    renderLeaderboard(state);
    return leaderboardContext;
  }

  if (
    !force
    && leaderboardContextState === 'loaded'
    && leaderboardContext?.player_id === playerId
    && Date.now() - leaderboardContextLoadedAt < LEADERBOARD_STALE_MS
  ) {
    renderLeaderboard(state);
    return leaderboardContext;
  }

  leaderboardContextState = 'loading';
  renderLeaderboard(state);

  const requestPlayerId = playerId;
  const requestPromise = (async () => {
    try {
      const context = await auth.fetchMyLeaderboardContext();
      if (context.player_id !== requestPlayerId) {
        throw new Error('Classement personnel reçu pour un autre joueur.');
      }

      const activePlayerId = currentLeaderboardPlayerId(auth.snapshot());
      if (
        activePlayerId !== requestPlayerId
        || leaderboardContextPlayerId !== requestPlayerId
      ) {
        return null;
      }

      leaderboardContext = context;
      leaderboardContextState = 'loaded';
      leaderboardContextLoadedAt = Date.now();
      return context;
    } catch (error) {
      if (leaderboardContextPlayerId === requestPlayerId) {
        leaderboardContextState = 'error';
      }
      console.warn('[Leaderboard] Contexte personnel indisponible.', error);
      return leaderboardContext?.player_id === requestPlayerId ? leaderboardContext : null;
    } finally {
      if (leaderboardContextPromise === requestPromise) {
        leaderboardContextPromise = null;
      }
      renderLeaderboard();
    }
  })();

  leaderboardContextPromise = requestPromise;
  return requestPromise;
}

async function loadPlayerPerformanceStats({ force = false } = {}) {
  const state = auth.snapshot();
  const playerId = currentLeaderboardPlayerId(state);

  if (!leaderboardSignedIn(state) || !auth.session || !playerId) {
    resetPlayerPerformanceStats(null);
    renderLeaderboard(state);
    return null;
  }
  if (playerPerformancePlayerId !== playerId) resetPlayerPerformanceStats(playerId);
  if (playerPerformancePromise) return playerPerformancePromise;
  if (!auth.configured || !navigator.onLine) {
    if (!playerPerformanceStats) playerPerformanceState = 'error';
    renderLeaderboard(state);
    return playerPerformanceStats;
  }
  if (!force && playerPerformanceState === 'loaded'
      && playerPerformanceStats?.player_id === playerId
      && Date.now() - playerPerformanceLoadedAt < LEADERBOARD_STALE_MS) {
    return playerPerformanceStats;
  }

  playerPerformanceState = 'loading';
  renderLeaderboard(state);
  const requestPlayerId = playerId;
  const requestPromise = (async () => {
    try {
      const stats = await auth.fetchMyPlayerPerformanceStats();
      if (stats.player_id !== requestPlayerId) throw new Error('Statistiques reçues pour un autre joueur.');
      if (currentLeaderboardPlayerId(auth.snapshot()) !== requestPlayerId || playerPerformancePlayerId !== requestPlayerId) return null;
      playerPerformanceStats = stats;
      playerPerformanceState = 'loaded';
      playerPerformanceLoadedAt = Date.now();
      return stats;
    } catch (error) {
      if (playerPerformancePlayerId === requestPlayerId) playerPerformanceState = 'error';
      console.warn('[Leaderboard] Statistiques personnelles indisponibles.', error);
      return playerPerformanceStats?.player_id === requestPlayerId ? playerPerformanceStats : null;
    } finally {
      if (playerPerformancePromise === requestPromise) playerPerformancePromise = null;
      renderLeaderboard();
    }
  })();
  playerPerformancePromise = requestPromise;
  return requestPromise;
}

function accountDisplayName(state) {
  return state.profile?.display_name || state.profile?.username || state.user?.user_metadata?.name || 'Joueur';
}

function accountUsername(state) {
  const value = state.profile?.username || state.user?.user_metadata?.user_name || state.user?.user_metadata?.preferred_username;
  return value ? `@${value}` : '';
}

function accountAvatar(state) {
  return state.profile?.avatar_url || state.user?.user_metadata?.avatar_url || state.user?.user_metadata?.picture || '';
}

function renderAccount(state = auth.snapshot()) {
  const signed = Boolean(state.user || state.profile) && ['signed_in', 'offline', 'loading'].includes(state.status);
  $('account-signed-out').hidden = signed;
  $('account-signed-in').hidden = !signed;
  $('discord-login').disabled = !state.configured || !navigator.onLine || state.status === 'loading';
  $('discord-logout').disabled = state.status === 'loading';

  if (!signed) {
    $('account-status').textContent = !state.configured
      ? 'Connexion communautaire non configurée sur cette build.'
      : state.status === 'error'
        ? 'Connexion indisponible pour le moment. Le jeu reste jouable localement.'
        : navigator.onLine
          ? 'Compte facultatif · connectez-vous pour retrouver votre profil sur tous vos appareils.'
          : 'Hors connexion · la connexion Discord sera disponible au retour du réseau.';
    return;
  }

  $('account-name').textContent = accountDisplayName(state);
  $('account-username').textContent = accountUsername(state);

  const avatar = accountAvatar(state);
  const image = $('account-avatar');
  const fallback = $('account-avatar-fallback');
  if (avatar) {
    image.src = avatar;
    image.hidden = false;
    fallback.hidden = true;
  } else {
    image.removeAttribute('src');
    image.hidden = true;
    fallback.hidden = false;
    fallback.textContent = accountDisplayName(state).slice(0, 1).toUpperCase() || '?';
  }

  $('account-status').textContent = state.status === 'offline' || scoreSyncState === 'offline'
    ? `Profil disponible hors connexion · record local ${best}, synchronisation au retour du réseau.`
    : state.status === 'loading' || scoreSyncState === 'syncing'
      ? 'Synchronisation du profil et du record…'
      : scoreSyncState === 'synced'
        ? `Connecté à Discord · record synchronisé : ${best}.`
        : scoreSyncState === 'error'
          ? `Connecté à Discord · record local ${best} · synchronisation à réessayer.`
          : state.error
            ? `Connecté à Discord · record local ${best} · profil à resynchroniser.`
            : 'Connecté avec Discord · profil synchronisé.';
}

$('account-avatar').addEventListener('error', () => {
  $('account-avatar').hidden = true;
  $('account-avatar-fallback').hidden = false;
});

auth.onChange(state => {
  const playerId = currentLeaderboardPlayerId(state);
  const playerChanged = playerId !== leaderboardContextPlayerId;
  if (playerChanged) {
    resetLeaderboardContext(playerId);
    resetPlayerPerformanceStats(playerId);
  }

  renderAccount(state);
  renderLeaderboard(state);

  if (
    playerChanged
    && playerId
    && auth.session
    && navigator.onLine
    && leaderboardDialog.open
  ) {
    void loadLeaderboardContext({ force: true });
    void loadPlayerPerformanceStats({ force: true });
  }
});
renderAccount();
renderLeaderboard();

$('discord-login').onclick = () => {
  try {
    auth.signInWithDiscord();
  } catch (error) {
    toast(error.message);
  }
};

$('discord-logout').onclick = async () => {
  $('discord-logout').disabled = true;
  await auth.signOut();
  scoreSyncState = 'local';
  scoreSyncError = null;
  renderAccount(auth.snapshot());
};

$('refresh-leaderboard').onclick = () => {
  void loadLeaderboard({ force: true, notify: true });
  void loadLeaderboardContext({ force: true });
  void loadPlayerPerformanceStats({ force: true });
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
  stage.style.setProperty('--game-width', `${size.gameWidth}px`);
  stage.style.setProperty('--game-height', `${size.gameHeight}px`);
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

  select.replaceChildren();
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = 'Auto';
  select.append(auto);

  for (const [id, definition] of themeEntries(themeCatalog)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = definition.label;
    select.append(option);
  }
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

function setUtilityAtlasIcon(mode) {
  const icon = $('utility-atlas-icon');
  const custom = renderer?.atlas?.custom;
  const spriteName = mode === 'home' ? 'button_home' : 'button_options';
  const sprite = custom?.sprites?.[spriteName];

  if (!icon || !custom || !sprite) {
    return;
  }

  icon.style.width = `${sprite.w * UTILITY_ATLAS_SCALE}px`;
  icon.style.height = `${sprite.h * UTILITY_ATLAS_SCALE}px`;
  icon.style.backgroundImage = `url("${custom.imageUrl}")`;
  icon.style.backgroundSize = `${custom.image.width * UTILITY_ATLAS_SCALE}px ${custom.image.height * UTILITY_ATLAS_SCALE}px`;
  icon.style.backgroundPosition = `-${sprite.x * UTILITY_ATLAS_SCALE}px -${sprite.y * UTILITY_ATLAS_SCALE}px`;
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
  setUtilityAtlasIcon(mode);
}

function returnToHome() {
  const state = game?.state;

  if (!game || !['READY', 'GAME_OVER'].includes(state) || !game.fade.done) {
    return;
  }

  if (verifiedRunRecorder && !verifiedRunRecorder.finished) {
    lastVerifiedRun = {
      status: 'abandoned',
      ...verifiedRunRecorder.snapshot(),
    };
  }
  verifiedRunRecorder = null;

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
  $('best-score').textContent = best;

  if (!options.open) {
    options.showModal();
  }

  syncUtilityVisibility();
  clearInput();
  clock.reset();
  checkForUpdates({ silent: true, reason: 'options-open' });
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

  renderLeaderboard();
  if (!leaderboardDialog.open) {
    leaderboardDialog.showModal();
  }

  syncUtilityVisibility();
  clearInput();
  clock.reset();
  void loadLeaderboard({ force });
  void loadLeaderboardContext({ force });
  void loadPlayerPerformanceStats({ force });
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
  if (!game || options.open || leaderboardDialog.open || unrankedWarning.open || verifiedStartPending) {
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
  if (options.open || leaderboardDialog.open || unrankedWarning.open || verifiedStartPending) {
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
new ResizeObserver(updateCanvasRect).observe(canvas);
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
$('close-leaderboard').onclick = closeLeaderboard;

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

function interceptAuthenticatedPlay(input) {
  if (!isPlayRelease(game, input)) {
    return false;
  }

  if (!allowUnrankedPlayOnce) {
    prepareVisualThemeForRun();
  }

  if (allowUnrankedPlayOnce) {
    allowUnrankedPlayOnce = false;
    return false;
  }

  const mode = verifiedRunStartMode({
    hasSession: Boolean(auth.session),
    online: navigator.onLine,
  });

  if (mode === 'local') {
    verifiedRunRecorder = null;
    return false;
  }

  // Neutralize the native release while the ticket request or warning is
  // pending. Verified runs immediately enter the original black transition,
  // hiding server latency behind the same visual cadence as the APK.
  game.play.pressed = false;
  game.play.released = false;
  const fadeStartedAt = mode === 'ticket' ? startVerifiedPlayFade(game) : null;
  beginAuthenticatedPlay(game, mode, fadeStartedAt);
  return true;
}

function tick(input = nextInput()) {
  if (currentCommands) {
    previousCommands = cloneCommands(currentCommands);
  }

  interceptAuthenticatedPlay(input);

  verifiedRunRecorder?.beforeTick(game, input);

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

  const verifiedSubmission = verifiedRunRecorder?.afterTick(game);
  if (verifiedSubmission) {
    queueVerifiedSubmission(verifiedSubmission);
  }

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

  lastUpdateToastVersion = pendingUpdateVersion;

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
  auth.sync({ reason: 'online' }).then(async state => {
    if (state.status === 'signed_in') {
      await syncBestWithCloud({ reason: 'online' });
      await flushVerifiedRunQueue({ reason: 'online', notify: true });
    }
  });
  if (leaderboardDialog.open) {
    void loadLeaderboard({ force: true });
    void loadLeaderboardContext({ force: true });
  } else {
    renderLeaderboard();
  }
  checkForUpdates({ silent: true, reason: 'online' });
});

window.addEventListener('offline', () => {
  audio.note('NETWORK_OFFLINE');
  scoreSyncState = auth.session ? 'offline' : 'local';
  renderAccount({ ...auth.snapshot(), status: auth.session ? 'offline' : 'signed_out' });
  renderLeaderboard({ ...auth.snapshot(), status: auth.session ? 'offline' : 'signed_out' });
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

    const authInit = auth.init().catch(error => ({ status: 'error', error: error.message }));
    const [atlas] = await Promise.all([
      loadAtlas(),
      audio.preload(),
    ]);

    themeCatalog = atlas.themes;
    renderer = new Renderer(canvas, atlas);
    game = new Game({
      seed,
      best,
      onEvent: handleGameEvent,
    });
    populateThemeDebugOptions();
    $('debug-theme').value = themeControls.mode;
    $('debug-theme-variant').value = themeControls.variant;
    selectVisualThemeForMenu();
    setUtilityAtlasIcon('options');

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
      renderAccount(auth.snapshot());
      if (state.status === 'signed_in') {
        await syncBestWithCloud({
          reason: auth.callbackResult === 'signed_in' ? 'discord-login' : 'startup',
          notify: auth.callbackResult === 'signed_in',
        });
        await flushVerifiedRunQueue({
          reason: auth.callbackResult === 'signed_in' ? 'discord-login' : 'startup',
          notify: true,
        });
      }

      if (auth.callbackResult === 'signed_in') {
        openOptions();
      } else if (auth.callbackResult === 'error') {
        toast(`Connexion Discord impossible : ${auth.error || 'erreur OAuth'}`);
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
      leaderboard: () => structuredClone(leaderboardRows),
      leaderboardContext: () => structuredClone(leaderboardContext),
      openLeaderboard: () => openLeaderboard({ force: true }),
      closeLeaderboard,
      refreshLeaderboard: () => Promise.all([
        loadLeaderboard({ force: true }),
        loadLeaderboardContext({ force: true }),
      ]),
      verifiedRun: () => verifiedRunRecorder?.snapshot() ?? structuredClone(lastVerifiedRun),
      theme: () => structuredClone({ controls: themeControls, active: activeVisualTheme }),
      pendingVerifiedRuns() {
        try {
          return readPendingVerifiedRuns();
        } catch {
          return [];
        }
      },
      flushVerifiedRuns: () => flushVerifiedRunQueue({ reason: 'diagnostic', notify: true }),
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
