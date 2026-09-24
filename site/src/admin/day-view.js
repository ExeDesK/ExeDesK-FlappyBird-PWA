import { renderBarChart, renderLineChart } from './charts.js';


function dayNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function dayParseIsoDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function dayUtcToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function dayAddDays(value, days) {
  const date = value instanceof Date ? new Date(value.getTime()) : dayParseIsoDate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function setDayText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function dayMaxRow(rows, key) {
  let best = null;
  for (const row of rows) {
    if (!best || dayNumber(row[key]) > dayNumber(best[key])) best = row;
  }
  return best;
}

function dayHourLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${String(date.getUTCHours()).padStart(2, '0')} h`;
}

function dayCollisionLabel(value) {
  if (value === 'upper-pipe') return 'Pipe haut';
  if (value === 'lower-pipe') return 'Pipe bas';
  if (value === 'ground') return 'Sol';
  return value || '—';
}

export class DayInsightsView {
  constructor({ analytics, formatters = {}, onPlayer = null, setStatus = null } = {}) {
    this.analytics = analytics;
    this.onPlayer = onPlayer;
    this.setStatus = setStatus || (() => {});
    this.formatNumber = formatters.number || (value => String(value ?? '—'));
    this.formatDecimal = formatters.decimal || this.formatNumber;
    this.formatPercent = formatters.percent || this.formatNumber;
    this.formatDurationTicks = formatters.durationTicks || this.formatNumber;
    this.formatDate = formatters.date || (value => String(value || '—'));
    this.formatDateTime = formatters.dateTime || (value => String(value || '—'));
    this.dateInput = document.getElementById('day-date');
    this.currentDate = dayIsoDate(dayUtcToday());
    this.loadedDate = null;
    this.serial = 0;

    if (this.dateInput) {
      this.dateInput.max = this.currentDate;
      this.dateInput.value = this.currentDate;
      this.dateInput.addEventListener('change', () => this.load(this.dateInput.value));
    }
    document.getElementById('day-today')?.addEventListener('click', () => this.load(dayIsoDate(dayUtcToday())));
    document.getElementById('day-yesterday')?.addEventListener('click', () => this.load(dayIsoDate(dayAddDays(dayUtcToday(), -1))));
    document.getElementById('day-prev')?.addEventListener('click', () => this.load(dayIsoDate(dayAddDays(this.currentDate, -1))));
    document.getElementById('day-next')?.addEventListener('click', () => {
      const next = dayAddDays(this.currentDate, 1);
      if (next && next <= dayUtcToday()) this.load(dayIsoDate(next));
    });
    document.getElementById('day-players-body')?.addEventListener('click', event => {
      const button = event.target.closest('[data-day-player-id]');
      if (!button || !this.onPlayer) return;
      this.onPlayer(button.dataset.dayPlayerId, this.currentDate);
    });
  }

  async ensureLoaded() {
    if (this.loadedDate === this.currentDate) return;
    await this.load(this.currentDate);
  }

  async load(value) {
    const parsed = dayParseIsoDate(value);
    const today = dayUtcToday();
    if (!parsed || parsed > today) {
      this.setStatus('Sélectionne une journée UTC valide, au plus tard aujourd’hui.', true);
      return;
    }

    const selected = dayIsoDate(parsed);
    this.currentDate = selected;
    this.dateInput.value = selected;
    document.getElementById('day-next').disabled = selected === dayIsoDate(today);
    this.updateTitle();
    const serial = ++this.serial;
    this.setStatus(`Chargement de la journée du ${this.formatDate(selected)}…`);

    try {
      const [overview, hourly, players, recentRuns] = await Promise.all([
        this.analytics.fetchDayOverview(selected),
        this.analytics.fetchDayHourly(selected),
        this.analytics.fetchPlayers({ from: selected, to: selected, limit: 10, sort: 'runs' }),
        this.analytics.fetchDayRecentRuns(selected, 30),
      ]);
      if (serial !== this.serial) return;
      if (!overview) throw new Error('Aucune donnée reçue pour cette journée.');
      this.render(overview, hourly, players, recentRuns);
      this.loadedDate = selected;
      this.setStatus(`Journée ${this.formatDate(selected)} chargée · heures UTC.`);
    } catch (error) {
      if (serial !== this.serial) return;
      this.setStatus(error?.message || String(error), true);
    }
  }

  updateTitle() {
    const today = dayIsoDate(dayUtcToday());
    const yesterday = dayIsoDate(dayAddDays(dayUtcToday(), -1));
    if (this.currentDate === today) setDayText('day-title', `Aujourd'hui · ${this.formatDate(this.currentDate)}`);
    else if (this.currentDate === yesterday) setDayText('day-title', `Hier · ${this.formatDate(this.currentDate)}`);
    else setDayText('day-title', this.formatDate(this.currentDate));
  }

  render(overview, hourly, players, recentRuns) {
    const active = dayNumber(overview.active_players);
    const newPlayers = dayNumber(overview.new_players);
    const newActive = dayNumber(overview.new_active_players);
    const runs = dayNumber(overview.verified_runs);
    const playTicks = dayNumber(overview.play_ticks);

    setDayText('day-active', this.formatNumber(active));
    setDayText('day-active-split', `${this.formatNumber(newActive)} nouveaux · ${this.formatNumber(overview.returning_players)} revenants`);
    setDayText('day-new-players', this.formatNumber(newPlayers));
    setDayText('day-acquisition', newPlayers > 0 ? `${this.formatPercent(newActive * 100 / newPlayers)} actifs le jour même` : 'aucun nouveau compte');
    setDayText('day-runs', this.formatNumber(runs));
    setDayText('day-runs-per-player', active > 0 ? `${this.formatDecimal(runs / active)} / joueur actif` : '— / joueur actif');
    setDayText('day-playtime', this.formatDurationTicks(playTicks));
    setDayText('day-playtime-per-player', active > 0 ? `${this.formatDurationTicks(playTicks / active)} / joueur actif` : '— / joueur actif');
    setDayText('day-average-score', runs > 0 ? this.formatDecimal(overview.average_score) : '—');
    setDayText('day-best-score', runs > 0 ? `record ${this.formatNumber(overview.best_score)}` : 'record —');
    setDayText('day-starts', this.formatNumber(overview.run_start_requests));
    setDayText('day-issue-rate', `${this.formatPercent(overview.issue_rate_pct)} tickets émis`);
    setDayText('day-verification-rate', this.formatPercent(overview.verification_rate_pct));
    setDayText('day-verification-detail', `${this.formatNumber(overview.issued_runs)} émises · ${this.formatNumber(overview.rejected_runs)} rejetées`);
    const protectionEvents = dayNumber(overview.rate_limited_requests) + dayNumber(overview.pending_limit_requests);
    setDayText('day-protection-events', this.formatNumber(protectionEvents));
    setDayText('day-protection-detail', `${this.formatNumber(overview.rate_limited_requests)} rate limit · ${this.formatNumber(overview.pending_limit_requests)} pending cap`);
    setDayText('day-first-run', this.formatDateTime(overview.first_run_at));
    setDayText('day-last-run', this.formatDateTime(overview.last_run_at));

    this.renderTrackingNote(overview);
    this.renderHourly(hourly);
    this.renderPlayers(players);
    this.renderRecentRuns(recentRuns);
  }

  renderTrackingNote(overview) {
    const dailyStart = overview.tracking_started_at ? new Date(overview.tracking_started_at) : null;
    const hourlyStart = overview.hourly_tracking_started_at ? new Date(overview.hourly_tracking_started_at) : null;
    const selected = dayParseIsoDate(this.currentDate);
    const note = document.getElementById('day-tracking-note');

    if (dailyStart && !Number.isNaN(dailyStart.getTime())) {
      const dailyStartDay = new Date(Date.UTC(dailyStart.getUTCFullYear(), dailyStart.getUTCMonth(), dailyStart.getUTCDate()));
      if (selected < dailyStartDay) {
        note.textContent = `Les créations de comptes restent visibles, mais l’activité / temps de jeu n’est suivi quotidiennement que depuis le ${this.formatDateTime(dailyStart.toISOString())} UTC.`;
        return;
      }
    }

    if (!hourlyStart || Number.isNaN(hourlyStart.getTime())) {
      note.textContent = 'Totaux journaliers disponibles ; le suivi horaire n’est pas encore initialisé.';
      return;
    }
    const hourlyStartDay = new Date(Date.UTC(hourlyStart.getUTCFullYear(), hourlyStart.getUTCMonth(), hourlyStart.getUTCDate()));
    if (selected < hourlyStartDay) {
      note.textContent = `Totaux journaliers autoritaires disponibles. Le détail par heure n’est suivi que depuis le ${this.formatDateTime(hourlyStart.toISOString())} UTC.`;
    } else if (selected.getTime() === hourlyStartDay.getTime()) {
      note.textContent = `Totaux journaliers complets ; suivi horaire partiel pour cette première journée à partir du ${this.formatDateTime(hourlyStart.toISOString())} UTC.`;
    } else {
      note.textContent = `Détail horaire autoritaire disponible · heures UTC · suivi depuis le ${this.formatDateTime(hourlyStart.toISOString())}.`;
    }
  }

  renderHourly(rows) {
    renderLineChart(document.getElementById('day-active-chart'), rows, {
      valueKey: 'active_players',
      secondaryKey: 'new_players',
      label: 'Joueurs actifs',
      secondaryLabel: 'Nouveaux comptes',
      valueFormatter: value => this.formatNumber(value),
      xKey: 'activity_hour',
      xFormatter: dayHourLabel,
    });
    renderLineChart(document.getElementById('day-runs-chart'), rows, {
      valueKey: 'verified_runs',
      secondaryKey: 'issued_runs',
      label: 'Runs vérifiées',
      secondaryLabel: 'Tickets émis',
      valueFormatter: value => this.formatNumber(value),
      xKey: 'activity_hour',
      xFormatter: dayHourLabel,
    });
    renderBarChart(document.getElementById('day-playtime-chart'), rows, {
      valueKey: 'play_ticks',
      label: 'Temps de jeu',
      valueFormatter: value => this.formatDurationTicks(value),
      xKey: 'activity_hour',
      xFormatter: dayHourLabel,
    });
    renderLineChart(document.getElementById('day-score-chart'), rows, {
      valueKey: 'average_score',
      secondaryKey: 'best_score',
      label: 'Score moyen',
      secondaryLabel: 'Record',
      valueFormatter: value => this.formatDecimal(value),
      xKey: 'activity_hour',
      xFormatter: dayHourLabel,
    });

    this.renderPeak('day-peak-active', dayMaxRow(rows, 'active_players'), 'active_players', this.formatNumber);
    this.renderPeak('day-peak-runs', dayMaxRow(rows, 'verified_runs'), 'verified_runs', this.formatNumber);
    this.renderPeak('day-peak-playtime', dayMaxRow(rows, 'play_ticks'), 'play_ticks', this.formatDurationTicks);
    this.renderPeak('day-peak-starts', dayMaxRow(rows, 'run_start_requests'), 'run_start_requests', this.formatNumber);

    const top = rows.reduce((sum, row) => sum + dayNumber(row.deaths_pipe_top), 0);
    const bottom = rows.reduce((sum, row) => sum + dayNumber(row.deaths_pipe_bottom), 0);
    const ground = rows.reduce((sum, row) => sum + dayNumber(row.deaths_ground), 0);
    const total = top + bottom + ground;
    this.renderDeath('top', top, total);
    this.renderDeath('bottom', bottom, total);
    this.renderDeath('ground', ground, total);
  }

  renderPeak(id, row, key, formatter) {
    if (!row || dayNumber(row[key]) <= 0) {
      setDayText(id, '—');
      return;
    }
    setDayText(id, `${formatter.call(this, row[key])} · ${dayHourLabel(row.activity_hour)}`);
  }

  renderDeath(name, value, total) {
    setDayText(`day-death-${name}`, this.formatNumber(value));
    const progress = document.getElementById(`day-death-${name}-progress`);
    if (progress) progress.value = total > 0 ? value * 100 / total : 0;
  }

  renderPlayers(rows) {
    const body = document.getElementById('day-players-body');
    const empty = document.getElementById('day-players-empty');
    body.replaceChildren();
    empty.hidden = rows.length > 0;
    for (const row of rows) {
      const tr = document.createElement('tr');
      const player = document.createElement('td');
      const button = document.createElement('button');
      button.className = 'table-player-button';
      button.type = 'button';
      button.dataset.dayPlayerId = row.player_id;
      button.textContent = row.display_name || row.username || String(row.player_id).slice(0, 8);
      player.append(button);
      for (const cellValue of [
        this.formatNumber(row.period_verified_runs),
        this.formatNumber(row.period_best_score),
        this.formatDurationTicks(row.period_play_ticks),
      ]) {
        const cell = document.createElement('td');
        cell.textContent = cellValue;
        tr.append(cell);
      }
      tr.prepend(player);
      body.append(tr);
    }
  }

  renderRecentRuns(rows) {
    const body = document.getElementById('day-runs-body');
    const empty = document.getElementById('day-runs-empty');
    body.replaceChildren();
    empty.hidden = rows.length > 0;
    for (const row of rows) {
      const tr = document.createElement('tr');
      const date = new Date(row.resolved_at);
      const time = Number.isNaN(date.getTime()) ? '—' : `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
      const player = row.display_name || row.username || String(row.player_id).slice(0, 8);
      for (const value of [time, player, this.formatNumber(row.score), dayCollisionLabel(row.collision)]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        tr.append(cell);
      }
      body.append(tr);
    }
  }
}
