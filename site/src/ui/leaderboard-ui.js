import { leaderboardName } from '../leaderboard.js';
import { applyGeneratedAvatarFallback } from './avatar-fallback.js';

const DEFAULT_STALE_MS = 60 * 1000;

function formatLeaderboardDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatStat(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(digits).replace(/\.0$/, '');
}

export class LeaderboardUI {
  constructor({
    auth,
    client,
    dialog,
    toast,
    getElement,
    onWatchReplay,
    staleMs = DEFAULT_STALE_MS,
  } = {}) {
    this.auth = auth;
    this.client = client;
    this.dialog = dialog;
    this.toast = toast;
    this.$ = getElement || (id => document.getElementById(id));
    this.onWatchReplay = onWatchReplay;
    this.staleMs = staleMs;

    this.rows = [];
    this.state = 'idle';
    this.promise = null;
    this.loadedAt = 0;

    this.context = null;
    this.contextState = 'idle';
    this.contextPromise = null;
    this.contextLoadedAt = 0;
    this.contextPlayerId = null;

    this.performance = null;
    this.performanceState = 'idle';
    this.performancePromise = null;
    this.performanceLoadedAt = 0;
    this.performancePlayerId = null;
  }

  signedIn(state = this.auth.snapshot()) {
    return Boolean(state.user || state.profile)
      && ['signed_in', 'offline', 'loading'].includes(state.status);
  }

  currentPlayerId(state = this.auth.snapshot()) {
    return state.user?.id || state.profile?.id || null;
  }

  resetContext(playerId = null) {
    this.context = null;
    this.contextState = 'idle';
    this.contextPromise = null;
    this.contextLoadedAt = 0;
    this.contextPlayerId = playerId;
  }

  resetPerformance(playerId = null) {
    this.performance = null;
    this.performanceState = 'idle';
    this.performancePromise = null;
    this.performanceLoadedAt = 0;
    this.performancePlayerId = playerId;
  }

  invalidateVerifiedData() {
    this.loadedAt = 0;
    this.contextLoadedAt = 0;
    this.performanceLoadedAt = 0;
  }

  applyProfile(profile) {
    if (!profile?.id) return false;

    let changed = false;
    this.rows = this.rows.map(row => {
      if (row.player_id !== profile.id) return row;
      changed = true;
      return {
        ...row,
        username: profile.username ?? row.username,
        display_name: profile.display_name ?? row.display_name,
        avatar_url: profile.avatar_url ?? null,
      };
    });

    // The local row is updated immediately while the next load still rechecks
    // the public Supabase view, avoiding a stale minute-long leaderboard cache.
    this.loadedAt = 0;
    if (changed) this.render();
    return changed;
  }

  onAuthChange(state = this.auth.snapshot()) {
    const playerId = this.currentPlayerId(state);
    const playerChanged = playerId !== this.contextPlayerId;
    if (playerChanged) {
      this.resetContext(playerId);
      this.resetPerformance(playerId);
    }

    this.render(state);

    if (
      playerChanged
      && playerId
      && this.auth.session
      && (typeof navigator === 'undefined' || navigator.onLine)
      && this.dialog?.open
    ) {
      void this.loadContext({ force: true });
      void this.loadPerformance({ force: true });
    }
  }

  renderContext(state = this.auth.snapshot()) {
    const card = this.$('leaderboard-player-card');
    const status = this.$('leaderboard-player-status');
    const rank = this.$('leaderboard-player-rank');
    const bestScore = this.$('leaderboard-player-best');
    const runs = this.$('leaderboard-player-runs');
    const recordDate = this.$('leaderboard-player-record-date');
    const signedIn = this.signedIn(state);
    const currentPlayerId = this.currentPlayerId(state);
    const hasContext = Boolean(
      this.context
      && currentPlayerId
      && this.context.player_id === currentPlayerId,
    );

    card.hidden = !signedIn;
    if (!signedIn) return;

    rank.textContent = '—';
    bestScore.textContent = '—';
    runs.textContent = '—';
    recordDate.textContent = 'Chargement de vos statistiques vérifiées...';

    if (!this.auth.configured) {
      status.textContent = 'INDISPONIBLE';
      recordDate.textContent = 'Statistiques personnelles indisponibles sur cette build.';
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine && !hasContext) {
      status.textContent = 'HORS CONNEXION';
      recordDate.textContent = 'Vos statistiques seront chargées au retour du réseau.';
      return;
    }

    if (this.contextState === 'loading' && !hasContext) {
      status.textContent = 'CHARGEMENT...';
      return;
    }

    if (this.contextState === 'error' && !hasContext) {
      status.textContent = 'INDISPONIBLE';
      recordDate.textContent = 'Impossible de charger votre classement pour le moment.';
      return;
    }

    if (!hasContext) {
      status.textContent = 'EN ATTENTE';
      return;
    }

    const count = this.context.verified_runs_count;
    runs.textContent = String(count);

    if (count === 0) {
      status.textContent = 'PAS ENCORE CLASSÉ';
      recordDate.textContent = 'Terminez une run vérifiée pour entrer dans le classement.';
      return;
    }

    rank.textContent = `#${this.context.global_rank}`;
    bestScore.textContent = String(this.context.best_score);
    status.textContent = typeof navigator === 'undefined' || navigator.onLine
      ? 'RUNS VÉRIFIÉS'
      : 'DERNIÈRE LECTURE';
    recordDate.textContent = `Record · ${formatLeaderboardDate(this.context.best_score_at)}`;
  }

  renderPerformance(state = this.auth.snapshot()) {
    const card = this.$('leaderboard-stats-card');
    const status = this.$('leaderboard-stats-status');
    const playerId = this.currentPlayerId(state);
    const signedIn = this.signedIn(state);
    const hasStats = Boolean(this.performance && this.performance.player_id === playerId);
    card.hidden = !signedIn;
    if (!signedIn) return;

    const ids = [
      'stats-career-average','stats-total-score','stats-trend',
      'stats-10-average','stats-10-best','stats-10-median','stats-10-regularity',
      'stats-25-average','stats-25-best','stats-25-median','stats-25-regularity',
      'stats-50-average','stats-50-best','stats-50-median','stats-50-regularity',
    ];
    for (const id of ids) this.$(id).textContent = '—';

    if (this.performanceState === 'loading' && !hasStats) {
      status.textContent = 'CHARGEMENT...';
      return;
    }
    if (this.performanceState === 'error' && !hasStats) {
      status.textContent = 'INDISPONIBLE';
      return;
    }
    if (!hasStats) {
      status.textContent = 'EN ATTENTE';
      return;
    }

    status.textContent = typeof navigator === 'undefined' || navigator.onLine
      ? 'RUNS VÉRIFIÉS'
      : 'DERNIÈRE LECTURE';
    this.$('stats-career-average').textContent = formatStat(this.performance.career_average);
    this.$('stats-total-score').textContent = String(this.performance.total_score);
    const trend = this.performance.recent_50_vs_career_pct;
    this.$('stats-trend').textContent = trend == null
      ? '—'
      : `${trend >= 0 ? '+' : ''}${formatStat(trend)}%`;

    for (const size of [10, 25, 50]) {
      const windowStats = this.performance[`recent_${size}`];
      this.$(`stats-${size}-average`).textContent = formatStat(windowStats.average);
      this.$(`stats-${size}-best`).textContent = windowStats.best == null ? '—' : String(windowStats.best);
      this.$(`stats-${size}-median`).textContent = formatStat(windowStats.median);
      this.$(`stats-${size}-regularity`).textContent = formatStat(windowStats.stddev);
    }
  }

  render(state = this.auth.snapshot()) {
    const list = this.$('leaderboard-list');
    const empty = this.$('leaderboard-empty');
    const status = this.$('leaderboard-status');
    const refresh = this.$('refresh-leaderboard');
    const currentPlayerId = this.currentPlayerId(state);

    this.$('leaderboard-login-hint').hidden = this.signedIn(state);
    refresh.disabled = !this.auth.configured
      || (typeof navigator !== 'undefined' && !navigator.onLine)
      || this.state === 'loading';
    this.renderContext(state);
    this.renderPerformance(state);

    if (!this.auth.configured) {
      status.textContent = 'Classement indisponible sur cette build.';
    } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
      status.textContent = 'Classement indisponible hors connexion.';
    } else if (this.state === 'loading') {
      status.textContent = 'Chargement du classement...';
    } else if (this.state === 'error') {
      status.textContent = 'Classement indisponible pour le moment.';
    } else if (this.state === 'loaded') {
      status.textContent = this.rows.length
        ? `Top ${this.rows.length} · meilleur score vérifié par joueur.`
        : 'Aucun score vérifié pour le moment.';
    } else {
      status.textContent = 'Classement public des runs vérifiés.';
    }

    list.replaceChildren();
    for (const row of this.rows) {
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
      applyGeneratedAvatarFallback(fallback, leaderboardName(row));
      avatarWrap.append(fallback);

      if (row.avatar_url) {
        const image = document.createElement('img');
        image.className = 'leaderboard-avatar';
        image.alt = '';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        image.src = row.avatar_url;
        image.addEventListener('load', () => { fallback.hidden = true; });
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

      const replay = document.createElement('button');
      replay.type = 'button';
      replay.className = 'leaderboard-replay-button';
      replay.textContent = 'VOIR';
      replay.disabled = !row.run_id || (typeof navigator !== 'undefined' && !navigator.onLine);
      replay.title = row.run_id ? 'Visionner cette run' : 'Replay indisponible';
      replay.setAttribute('aria-label', `Visionner la run de ${leaderboardName(row)}`);
      replay.addEventListener('click', () => {
        if (row.run_id) this.onWatchReplay?.(row);
      });

      item.append(rank, avatarWrap, identity, score, replay);
      list.append(item);
    }

    empty.hidden = this.rows.length > 0 || this.state !== 'loaded';
  }

  async load({ force = false, notify = false } = {}) {
    if (this.promise) return this.promise;

    if (!this.auth.configured || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      this.state = 'error';
      this.render();
      return this.rows;
    }

    if (!force && this.state === 'loaded' && Date.now() - this.loadedAt < this.staleMs) {
      this.render();
      return this.rows;
    }

    this.state = 'loading';
    this.render();

    this.promise = (async () => {
      try {
        this.rows = await this.client.fetchLeaderboard({ limit: 100 });
        this.state = 'loaded';
        this.loadedAt = Date.now();
        return this.rows;
      } catch (error) {
        this.state = 'error';
        console.warn('[Leaderboard] Chargement impossible.', error);
        if (notify) this.toast?.('Impossible d’actualiser le classement.');
        return this.rows;
      } finally {
        this.promise = null;
        this.render();
      }
    })();

    return this.promise;
  }

  async loadContext({ force = false } = {}) {
    const state = this.auth.snapshot();
    const playerId = this.currentPlayerId(state);

    if (!this.signedIn(state) || !this.auth.session || !playerId) {
      this.resetContext(null);
      this.render(state);
      return null;
    }

    if (this.contextPlayerId !== playerId) this.resetContext(playerId);
    if (this.contextPromise) return this.contextPromise;

    if (!this.auth.configured || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      if (!this.context) this.contextState = 'error';
      this.render(state);
      return this.context;
    }

    if (
      !force
      && this.contextState === 'loaded'
      && this.context?.player_id === playerId
      && Date.now() - this.contextLoadedAt < this.staleMs
    ) {
      this.render(state);
      return this.context;
    }

    this.contextState = 'loading';
    this.render(state);
    const requestPlayerId = playerId;
    const requestPromise = (async () => {
      try {
        const context = await this.client.fetchMyLeaderboardContext();
        if (context.player_id !== requestPlayerId) {
          throw new Error('Classement personnel reçu pour un autre joueur.');
        }

        const activePlayerId = this.currentPlayerId(this.auth.snapshot());
        if (activePlayerId !== requestPlayerId || this.contextPlayerId !== requestPlayerId) {
          return null;
        }

        this.context = context;
        this.contextState = 'loaded';
        this.contextLoadedAt = Date.now();
        return context;
      } catch (error) {
        if (this.contextPlayerId === requestPlayerId) this.contextState = 'error';
        console.warn('[Leaderboard] Contexte personnel indisponible.', error);
        return this.context?.player_id === requestPlayerId ? this.context : null;
      } finally {
        if (this.contextPromise === requestPromise) this.contextPromise = null;
        this.render();
      }
    })();

    this.contextPromise = requestPromise;
    return requestPromise;
  }

  async loadPerformance({ force = false } = {}) {
    const state = this.auth.snapshot();
    const playerId = this.currentPlayerId(state);

    if (!this.signedIn(state) || !this.auth.session || !playerId) {
      this.resetPerformance(null);
      this.render(state);
      return null;
    }
    if (this.performancePlayerId !== playerId) this.resetPerformance(playerId);
    if (this.performancePromise) return this.performancePromise;
    if (!this.auth.configured || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      if (!this.performance) this.performanceState = 'error';
      this.render(state);
      return this.performance;
    }
    if (
      !force
      && this.performanceState === 'loaded'
      && this.performance?.player_id === playerId
      && Date.now() - this.performanceLoadedAt < this.staleMs
    ) {
      return this.performance;
    }

    this.performanceState = 'loading';
    this.render(state);
    const requestPlayerId = playerId;
    const requestPromise = (async () => {
      try {
        const stats = await this.client.fetchMyPlayerPerformanceStats();
        if (stats.player_id !== requestPlayerId) {
          throw new Error('Statistiques reçues pour un autre joueur.');
        }
        if (
          this.currentPlayerId(this.auth.snapshot()) !== requestPlayerId
          || this.performancePlayerId !== requestPlayerId
        ) {
          return null;
        }
        this.performance = stats;
        this.performanceState = 'loaded';
        this.performanceLoadedAt = Date.now();
        return stats;
      } catch (error) {
        if (this.performancePlayerId === requestPlayerId) this.performanceState = 'error';
        console.warn('[Leaderboard] Statistiques personnelles indisponibles.', error);
        return this.performance?.player_id === requestPlayerId ? this.performance : null;
      } finally {
        if (this.performancePromise === requestPromise) this.performancePromise = null;
        this.render();
      }
    })();

    this.performancePromise = requestPromise;
    return requestPromise;
  }

  async refreshAll({ force = true, notify = false } = {}) {
    return Promise.all([
      this.load({ force, notify }),
      this.loadContext({ force }),
      this.loadPerformance({ force }),
    ]);
  }
}

export { formatLeaderboardDate, formatStat };
