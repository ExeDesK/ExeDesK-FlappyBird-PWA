import { applyGeneratedAvatarFallback } from '../ui/avatar-fallback.js';

import { AuthClient } from '../auth.js';
import { AnalyticsClient } from './analytics-client.js';
import { renderBarChart, renderLineChart } from './charts.js';
import { DayInsightsView } from './day-view.js';
import { PlayerDetailPanel } from './player-detail.js';

const VERSION = '0.2.8b-hotfix1';
const TICKS_PER_SECOND = 60;
const DAY_MS = 86400000;
const MAX_RANGE_DAYS = 3650;

const config = globalThis.FLAPPY_CONFIG || {};
const auth = new AuthClient({
  url: config.supabaseUrl,
  publishableKey: config.supabasePublishableKey,
});
const analytics = new AnalyticsClient({
  url: config.supabaseUrl,
  publishableKey: config.supabasePublishableKey,
  getAccessToken: () => auth.accessToken(),
});

const numberFormatter = new Intl.NumberFormat('fr-FR');
const decimalFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
});
const shortDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: '2-digit', timeZone: 'UTC',
});
const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
});

const ui = {
  gate: document.querySelector('#auth-gate'),
  gateTitle: document.querySelector('#gate-title'),
  gateMessage: document.querySelector('#gate-message'),
  signInDiscord: document.querySelector('#sign-in-discord'),
  signInGoogle: document.querySelector('#sign-in-google'),
  signOut: document.querySelector('#sign-out'),
  dashboard: document.querySelector('#dashboard'),
  status: document.querySelector('#dashboard-status'),
  trackingNote: document.querySelector('#tracking-note'),
  refresh: document.querySelector('#refresh'),
  tabs: [...document.querySelectorAll('.tab[data-section]')],
  sections: new Map([...document.querySelectorAll('.dashboard-section')].map(node => [node.id.replace('section-', ''), node])),
  periodCard: document.querySelector('.period-card'),
  periodForm: document.querySelector('#period-form'),
  periodFrom: document.querySelector('#period-from'),
  periodTo: document.querySelector('#period-to'),
  periodSummary: document.querySelector('#period-summary'),
  periodPresets: [...document.querySelectorAll('.period-preset[data-period]')],
  retentionRange: document.querySelector('#retention-range'),
  playerFilter: document.querySelector('#player-filter'),
  playerSearch: document.querySelector('#player-search'),
  playerSort: document.querySelector('#player-sort'),
  playersBody: document.querySelector('#players-body'),
  playersEmpty: document.querySelector('#players-empty'),
  retentionBody: document.querySelector('#retention-body'),
  retentionEmpty: document.querySelector('#retention-empty'),
};

let authorized = false;
let loadSerial = 0;
let selectedRange = defaultRange();
let activeSectionName = 'overview';
let lastPlayerRows = [];

function number(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatNumber(value) {
  return numberFormatter.format(number(value));
}

function formatDecimal(value) {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? decimalFormatter.format(numeric) : '—';
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${decimalFormatter.format(numeric)} %` : '—';
}

function parseIsoDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function utcToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(value, days) {
  const date = value instanceof Date ? new Date(value.getTime()) : parseIsoDate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function rangeDays(range) {
  const from = parseIsoDate(range?.from);
  const to = parseIsoDate(range?.to);
  if (!from || !to) return 0;
  return Math.floor((to - from) / DAY_MS) + 1;
}

function defaultRange() {
  const to = utcToday();
  return { from: isoDate(addDays(to, -29)), to: isoDate(to) };
}

function validateRange(range) {
  const from = parseIsoDate(range?.from);
  const to = parseIsoDate(range?.to);
  const today = utcToday();
  if (!from || !to) throw new Error('Sélectionne une date de début et une date de fin valides.');
  if (from > to) throw new Error('La date “Du” doit être antérieure ou égale à la date “Au”.');
  if (to > today) throw new Error('La période Analytics ne peut pas se terminer dans le futur.');
  const days = Math.floor((to - from) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) throw new Error(`La période est limitée à ${MAX_RANGE_DAYS} jours.`);
  return { from: isoDate(from), to: isoDate(to) };
}

function presetRange(name) {
  const today = utcToday();
  if (name === 'today') return { from: isoDate(today), to: isoDate(today) };
  if (name === 'yesterday') {
    const yesterday = addDays(today, -1);
    return { from: isoDate(yesterday), to: isoDate(yesterday) };
  }
  const days = name === 'all' ? MAX_RANGE_DAYS : Number(name);
  if (!Number.isInteger(days) || days < 1) return defaultRange();
  return { from: isoDate(addDays(today, -(days - 1))), to: isoDate(today) };
}

function rangesEqual(a, b) {
  return a?.from === b?.from && a?.to === b?.to;
}

function formatDate(value) {
  if (!value) return '—';
  const date = parseIsoDate(String(value).slice(0, 10)) || new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

function formatShortDate(value) {
  if (!value) return '—';
  const date = parseIsoDate(String(value).slice(0, 10)) || new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : shortDateFormatter.format(date);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

function formatDurationTicks(ticks) {
  const seconds = Math.max(0, Math.round(number(ticks) / TICKS_PER_SECOND));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days) return `${days}j ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function setText(selector, value) {
  const node = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (node) node.textContent = value;
}

function setStatus(message = '', error = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle('error', Boolean(error));
}

function showGate(title, message, { allowLogin = true } = {}) {
  ui.gate.hidden = false;
  ui.dashboard.hidden = true;
  ui.signOut.hidden = true;
  ui.gateTitle.textContent = title;
  ui.gateMessage.textContent = message;
  ui.signInDiscord.hidden = !allowLogin;
  ui.signInGoogle.hidden = !allowLogin;
}

function showDashboard() {
  ui.gate.hidden = true;
  ui.dashboard.hidden = false;
  ui.signOut.hidden = false;
}

function periodLabel(range = selectedRange) {
  const today = presetRange('today');
  const yesterday = presetRange('yesterday');
  if (rangesEqual(range, today)) return `Aujourd'hui · ${formatDate(range.to)}`;
  if (rangesEqual(range, yesterday)) return `Hier · ${formatDate(range.to)}`;
  const days = rangeDays(range);
  if (range.from === range.to) return formatDate(range.from);
  return `Du ${formatDate(range.from)} au ${formatDate(range.to)} · ${formatNumber(days)} jours`;
}

function updatePeriodUi({ updateUrl = true } = {}) {
  ui.periodFrom.value = selectedRange.from;
  ui.periodTo.value = selectedRange.to;
  ui.periodSummary.textContent = periodLabel();
  if (ui.retentionRange) ui.retentionRange.textContent = periodLabel();

  for (const button of ui.periodPresets) {
    button.classList.toggle('active', rangesEqual(selectedRange, presetRange(button.dataset.period)));
  }

  if (updateUrl && globalThis.history?.replaceState) {
    const url = new URL(globalThis.location.href);
    url.searchParams.set('from', selectedRange.from);
    url.searchParams.set('to', selectedRange.to);
    history.replaceState(null, '', url);
  }
}

function initializePeriodControls() {
  const today = isoDate(utcToday());
  ui.periodFrom.max = today;
  ui.periodTo.max = today;

  try {
    const params = new URLSearchParams(globalThis.location?.search || '');
    const from = params.get('from');
    const to = params.get('to');
    if (from && to) selectedRange = validateRange({ from, to });
  } catch {
    selectedRange = defaultRange();
  }
  updatePeriodUi({ updateUrl: false });
}

function renderTrackingNote(overview) {
  if (!overview?.tracking_started_at) {
    ui.trackingNote.textContent = `v${VERSION} · Analytics autoritaires · journées UTC`;
    return;
  }
  const trackingDate = String(overview.tracking_started_at).slice(0, 10);
  const startsBeforeTracking = selectedRange.from < trackingDate;
  const suffix = startsBeforeTracking
    ? ' · la plage commence avant le suivi quotidien : aucune activité historique n’est inventée.'
    : '';
  ui.trackingNote.textContent = `v${VERSION} · suivi quotidien / temps de jeu depuis le ${formatDateTime(overview.tracking_started_at)} UTC${suffix}`;
}

function maxRow(rows, key) {
  let best = null;
  for (const row of rows) {
    if (!best || number(row[key]) > number(best[key])) best = row;
  }
  return best;
}

function renderPeriodSummary(overview, daily) {
  const activeDays = daily.filter(row => number(row.active_players) > 0).length;
  const peakActive = maxRow(daily, 'active_players');
  const peakRuns = maxRow(daily, 'verified_runs');
  setText('#period-range-label', periodLabel({
    from: overview.selected_from || selectedRange.from,
    to: overview.selected_to || selectedRange.to,
  }));
  setText('#period-active-days', `${formatNumber(activeDays)} / ${formatNumber(overview.selected_days || rangeDays(selectedRange))}`);
  setText('#period-peak-active', peakActive
    ? `${formatNumber(peakActive.active_players)} · ${formatShortDate(peakActive.activity_date)}`
    : '—');
  setText('#period-peak-runs', peakRuns
    ? `${formatNumber(peakRuns.verified_runs)} · ${formatShortDate(peakRuns.activity_date)}`
    : '—');
  setText('#period-issue-rate', formatPercent(overview.issue_rate_pct));
  setText('#period-rejection-rate', formatPercent(overview.rejection_rate_pct));
}

function renderOverview(overview, daily) {
  renderTrackingNote(overview);

  setText('#kpi-players', formatNumber(overview.total_players));
  setText('#kpi-new-players', `+${formatNumber(overview.new_players)} sur la période`);
  setText('#kpi-active', formatNumber(overview.active_players));
  setText('#kpi-active-split', `${formatNumber(overview.new_active_players)} nouveaux · ${formatNumber(overview.returning_active_players)} revenants`);
  setText('#kpi-dau', formatNumber(overview.dau));
  setText('#kpi-audience', `WAU ${formatNumber(overview.wau)} · MAU ${formatNumber(overview.mau)}`);
  setText('#kpi-runs', formatNumber(overview.window_verified_runs));
  setText('#kpi-runs-per-player', `${formatDecimal(overview.runs_per_active_player)} / joueur actif`);
  setText('#kpi-playtime', formatDurationTicks(overview.window_play_ticks));
  setText('#kpi-playtime-per-player', `${formatDurationTicks(overview.play_ticks_per_active_player)} / joueur actif`);
  setText('#kpi-period-average', formatDecimal(overview.window_average_score));
  setText('#kpi-records', `record période ${formatNumber(overview.period_best_score)} · global ${formatNumber(overview.global_best_score)}`);
  setText('#kpi-verification', formatPercent(overview.verification_rate_pct));
  setText('#kpi-verification-detail', `${formatNumber(overview.issued_runs)} émises · ${formatNumber(overview.rejected_runs)} rejetées`);
  setText('#kpi-acquisition', formatNumber(overview.new_players));
  const acquisitionPct = number(overview.new_players) > 0
    ? number(overview.new_active_players) * 100 / number(overview.new_players)
    : null;
  setText('#kpi-acquisition-detail', acquisitionPct === null
    ? 'aucun nouveau compte'
    : `${formatPercent(acquisitionPct)} actifs parmi les nouveaux`);

  setText('#pending-now', formatNumber(overview.pending_issued));
  setText('#rejected-now', formatNumber(overview.retained_rejected));
  setText('#tracked-total', formatDurationTicks(overview.tracked_play_ticks_total));
  setText('#kpi-runs-lifetime', formatNumber(overview.lifetime_verified_runs));

  const top = number(overview.deaths_pipe_top);
  const bottom = number(overview.deaths_pipe_bottom);
  const ground = number(overview.deaths_ground);
  const totalDeaths = Math.max(1, top + bottom + ground);
  for (const [labelSelector, progressSelector, count] of [
    ['#death-top', '#death-top-progress', top],
    ['#death-bottom', '#death-bottom-progress', bottom],
    ['#death-ground', '#death-ground-progress', ground],
  ]) {
    const pct = count * 100 / totalDeaths;
    setText(labelSelector, `${formatNumber(count)} · ${formatPercent(pct)}`);
    document.querySelector(progressSelector).value = pct;
  }

  setText('#sys-starts', formatNumber(overview.run_start_requests));
  setText('#sys-issued', formatNumber(overview.issued_runs));
  setText('#sys-issue-rate', `${formatPercent(overview.issue_rate_pct)} des run-start`);
  setText('#sys-verified', formatNumber(overview.window_verified_runs));
  setText('#sys-verification-rate', `${formatPercent(overview.verification_rate_pct)} des tickets émis`);
  setText('#sys-rejected', formatNumber(overview.rejected_runs));
  setText('#sys-rejection-rate', `${formatPercent(overview.rejection_rate_pct)} des tickets émis`);
  setText('#sys-expired', formatNumber(overview.expired_issued_runs));
  setText('#sys-purged', formatNumber(overview.purged_rejected_runs));
  setText('#sys-rate', formatNumber(overview.rate_limited_requests));
  setText('#sys-pending-cap', formatNumber(overview.pending_limit_requests));

  renderPeriodSummary(overview, daily);

  renderLineChart(document.querySelector('#runs-chart'), daily, {
    valueKey: 'verified_runs',
    secondaryKey: 'issued_runs',
    label: 'Runs vérifiées',
    secondaryLabel: 'Tickets émis',
    valueFormatter: formatNumber,
  });
  renderLineChart(document.querySelector('#active-chart'), daily, {
    valueKey: 'active_players',
    secondaryKey: 'new_players',
    label: 'Joueurs actifs',
    secondaryLabel: 'Nouveaux comptes',
    valueFormatter: formatNumber,
  });
  renderBarChart(document.querySelector('#playtime-chart'), daily, {
    valueKey: 'play_ticks',
    label: 'Temps de jeu vérifié',
    valueFormatter: formatDurationTicks,
  });
  renderLineChart(document.querySelector('#score-chart'), daily, {
    valueKey: 'average_score',
    secondaryKey: 'best_score',
    label: 'Score moyen',
    secondaryLabel: 'Meilleur score',
    valueFormatter: formatDecimal,
  });
  renderLineChart(document.querySelector('#system-chart'), daily, {
    valueKey: 'issued_runs',
    secondaryKey: 'rejected_runs',
    label: 'Tickets émis',
    secondaryLabel: 'Runs rejetées',
    valueFormatter: formatNumber,
  });
}

const playerDetail = new PlayerDetailPanel({
  analytics,
  formatters: {
    number: formatNumber,
    decimal: formatDecimal,
    durationTicks: formatDurationTicks,
    date: formatDate,
    dateTime: formatDateTime,
  },
});

const dayView = new DayInsightsView({
  analytics,
  setStatus,
  formatters: {
    number: formatNumber,
    decimal: formatDecimal,
    percent: formatPercent,
    durationTicks: formatDurationTicks,
    date: formatDate,
    dateTime: formatDateTime,
  },
  onPlayer: (playerId, date) => playerDetail.open({ player_id: playerId }, { from: date, to: date }),
});

function playerLabel(row) {
  return row.display_name || row.username || String(row.player_id).slice(0, 8);
}

function createPlayerCell(row) {
  const cell = document.createElement('td');
  const wrap = document.createElement('div');
  wrap.className = 'player-cell';

  let avatar;
  if (row.avatar_url) {
    avatar = document.createElement('img');
    avatar.src = row.avatar_url;
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.referrerPolicy = 'no-referrer';
    avatar.className = 'player-avatar';
  } else {
    avatar = document.createElement('div');
    avatar.className = 'player-avatar player-avatar-fallback';
    applyGeneratedAvatarFallback(avatar, playerLabel(row));
  }

  const name = document.createElement('span');
  name.className = 'player-name';
  const strong = document.createElement('strong');
  strong.textContent = playerLabel(row);
  const small = document.createElement('small');
  small.textContent = row.username ? `@${row.username}` : String(row.player_id).slice(0, 13);
  small.title = row.player_id;
  name.append(strong, small);
  wrap.append(avatar, name);
  cell.append(wrap);
  return cell;
}

function td(value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = value;
  if (className) cell.className = className;
  return cell;
}

function renderPlayers(rows) {
  lastPlayerRows = rows;
  ui.playersBody.replaceChildren();
  ui.playersEmpty.hidden = rows.length > 0;

  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.className = 'player-row';
    tr.dataset.playerId = row.player_id;
    tr.tabIndex = 0;
    const pending = number(row.pending_issued);
    tr.append(
      createPlayerCell(row),
      td(row.global_rank ? `#${formatNumber(row.global_rank)}` : '—'),
      td(formatNumber(row.period_verified_runs)),
      td(formatNumber(row.period_best_score)),
      td(formatDecimal(row.period_average_score)),
      td(formatDurationTicks(row.period_play_ticks)),
      td(formatNumber(row.period_active_days)),
      td(formatNumber(row.lifetime_best_score)),
      td(formatNumber(pending), pending >= 8 ? 'pending-warning' : ''),
      td(formatDateTime(row.period_last_run_at)),
    );
    ui.playersBody.append(tr);
  }
}

function retentionCell(count, pct, matured = true) {
  if (!matured || pct === null || pct === undefined) {
    return td('—', 'retention-pending');
  }
  return td(`${formatPercent(pct)} · ${formatNumber(count)}`, 'retention-value');
}

function renderRetention(rows) {
  ui.retentionBody.replaceChildren();
  ui.retentionEmpty.hidden = rows.length > 0;
  const today = utcToday().getTime();

  for (const row of rows) {
    const cohort = parseIsoDate(row.cohort_date)?.getTime() || 0;
    const ageDays = Math.floor((today - cohort) / DAY_MS);
    const tr = document.createElement('tr');
    tr.append(
      td(formatDate(row.cohort_date)),
      td(formatNumber(row.cohort_size)),
      retentionCell(row.d0_active, row.d0_pct, true),
      retentionCell(row.d1_active, row.d1_pct, ageDays >= 1),
      retentionCell(row.d7_active, row.d7_pct, ageDays >= 7),
      retentionCell(row.d30_active, row.d30_pct, ageDays >= 30),
    );
    ui.retentionBody.append(tr);
  }
}

async function loadPlayers() {
  if (!authorized) return;
  const rows = await analytics.fetchPlayers({
    ...selectedRange,
    search: ui.playerSearch.value,
    sort: ui.playerSort.value,
    limit: 100,
  });
  renderPlayers(rows);
}

async function loadRetention() {
  if (!authorized) return;
  const rows = await analytics.fetchRetention(selectedRange);
  renderRetention(rows);
}

async function loadDashboard({ includeTables = true } = {}) {
  if (!authorized) return;
  const serial = ++loadSerial;
  const range = { ...selectedRange };
  setStatus(`Actualisation · ${periodLabel(range)}…`);
  ui.refresh.disabled = true;

  try {
    const requests = [
      analytics.fetchOverview(range),
      analytics.fetchDaily(range),
      includeTables ? analytics.fetchPlayers({
        ...range,
        search: ui.playerSearch.value,
        sort: ui.playerSort.value,
        limit: 100,
      }) : Promise.resolve(null),
      includeTables ? analytics.fetchRetention(range) : Promise.resolve(null),
    ];
    const [overview, daily, players, retention] = await Promise.all(requests);
    if (serial !== loadSerial) return;
    if (!overview) throw new Error('Aucune donnée Analytics reçue.');
    renderOverview(overview, daily);
    if (players) renderPlayers(players);
    if (retention) renderRetention(retention);
    setStatus(`Mis à jour à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · ${periodLabel(range)} · journées UTC.`);
  } catch (error) {
    if (serial !== loadSerial) return;
    setStatus(error?.message || String(error), true);
  } finally {
    if (serial === loadSerial) ui.refresh.disabled = false;
  }
}

function activateSection(name) {
  activeSectionName = name;
  for (const [sectionName, node] of ui.sections) {
    node.hidden = sectionName !== name;
  }
  for (const tab of ui.tabs) {
    tab.classList.toggle('active', tab.dataset.section === name);
  }
  if (ui.periodCard) ui.periodCard.hidden = name === 'day';
  if (name === 'day' && authorized) dayView.ensureLoaded();
}

async function authorizeAndLoad() {
  showGate('Vérification de l’accès', 'Validation de ton compte administrateur côté Supabase…', { allowLogin: false });
  ui.signOut.hidden = false;
  try {
    authorized = await analytics.isAdmin();
    if (!authorized) {
      showGate(
        'Accès refusé',
        'Ce compte est authentifié mais ne figure pas dans analytics_admins. Ajoute son UUID depuis le SQL Editor Supabase.',
        { allowLogin: false },
      );
      ui.signOut.hidden = false;
      return;
    }
    showDashboard();
    await loadDashboard();
  } catch (error) {
    authorized = false;
    showGate('Analytics indisponibles', error?.message || String(error), { allowLogin: false });
    ui.signOut.hidden = false;
  }
}

async function boot() {
  initializePeriodControls();

  if (!auth.configured) {
    showGate(
      'Supabase non configuré',
      'Le fichier runtime config.js est absent ou incomplet. Le dashboard Admin nécessite la configuration Supabase du déploiement.',
      { allowLogin: false },
    );
    return;
  }

  const state = await auth.init();
  if (state.status === 'signed_in') {
    await authorizeAndLoad();
    return;
  }
  if (state.status === 'offline') {
    showGate('Connexion requise', 'Le dashboard Admin est volontairement online-only. Reconnecte le réseau puis recharge la page.');
    return;
  }
  if (state.status === 'error') {
    showGate('Erreur de connexion', state.error || 'Impossible de restaurer la session.');
    return;
  }
  showGate('Connexion requise', 'Connecte-toi avec Discord ou Google. L’accès est ensuite contrôlé par une allow-list Supabase.');
}

ui.signInDiscord.addEventListener('click', () => {
  try {
    auth.signInWithDiscord();
  } catch (error) {
    showGate('Connexion impossible', error?.message || String(error));
  }
});

ui.signInGoogle.addEventListener('click', () => {
  try {
    auth.signInWithProvider('google');
  } catch (error) {
    showGate('Connexion impossible', error?.message || String(error));
  }
});

ui.signOut.addEventListener('click', async () => {
  await auth.signOut();
  authorized = false;
  showGate('Connexion requise', 'Session fermée. Connecte-toi avec Discord ou Google pour accéder aux Analytics.');
});

ui.refresh.addEventListener('click', () => {
  if (activeSectionName === 'day') dayView.load(dayView.currentDate);
  else loadDashboard();
});
ui.periodForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    selectedRange = validateRange({ from: ui.periodFrom.value, to: ui.periodTo.value });
    updatePeriodUi();
    await loadDashboard();
  } catch (error) {
    setStatus(error?.message || String(error), true);
  }
});
for (const button of ui.periodPresets) {
  button.addEventListener('click', async () => {
    selectedRange = presetRange(button.dataset.period);
    updatePeriodUi();
    await loadDashboard();
  });
}
ui.playerSort.addEventListener('change', async () => {
  try {
    await loadPlayers();
  } catch (error) {
    setStatus(error?.message || String(error), true);
  }
});
ui.playerFilter.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await loadPlayers();
  } catch (error) {
    setStatus(error?.message || String(error), true);
  }
});
ui.playersBody.addEventListener('click', event => {
  const rowNode = event.target.closest('tr[data-player-id]');
  if (!rowNode) return;
  const row = lastPlayerRows.find(item => item.player_id === rowNode.dataset.playerId);
  if (row) playerDetail.open(row, selectedRange);
});
ui.playersBody.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const rowNode = event.target.closest('tr[data-player-id]');
  if (!rowNode) return;
  event.preventDefault();
  const row = lastPlayerRows.find(item => item.player_id === rowNode.dataset.playerId);
  if (row) playerDetail.open(row, selectedRange);
});

for (const tab of ui.tabs) {
  tab.addEventListener('click', () => activateSection(tab.dataset.section));
}

activateSection('overview');
boot();
