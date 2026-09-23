import { AuthClient } from '../auth.js';
import { AnalyticsClient } from './analytics-client.js';
import { renderBarChart, renderLineChart } from './charts.js';

const VERSION = '0.2.7.4b-dev8';
const TICKS_PER_SECOND = 60;

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
const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
});

const ui = {
  gate: document.querySelector('#auth-gate'),
  gateTitle: document.querySelector('#gate-title'),
  gateMessage: document.querySelector('#gate-message'),
  signIn: document.querySelector('#sign-in'),
  signOut: document.querySelector('#sign-out'),
  dashboard: document.querySelector('#dashboard'),
  status: document.querySelector('#dashboard-status'),
  trackingNote: document.querySelector('#tracking-note'),
  windowDays: document.querySelector('#window-days'),
  retentionDays: document.querySelector('#retention-days'),
  refresh: document.querySelector('#refresh'),
  tabs: [...document.querySelectorAll('.tab[data-section]')],
  sections: new Map([...document.querySelectorAll('.dashboard-section')].map(node => [node.id.replace('section-', ''), node])),
  playerFilter: document.querySelector('#player-filter'),
  playerSearch: document.querySelector('#player-search'),
  playerSort: document.querySelector('#player-sort'),
  playersBody: document.querySelector('#players-body'),
  playersEmpty: document.querySelector('#players-empty'),
  retentionBody: document.querySelector('#retention-body'),
  retentionEmpty: document.querySelector('#retention-empty'),
};

let authorized = false;
let currentOverview = null;
let currentDaily = [];
let loadSerial = 0;

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

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
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
  ui.signIn.hidden = !allowLogin;
}

function showDashboard() {
  ui.gate.hidden = true;
  ui.dashboard.hidden = false;
  ui.signOut.hidden = false;
}

function selectedDays() {
  return Math.max(1, Number(ui.windowDays.value) || 30);
}

function retentionDays() {
  return Math.max(1, Number(ui.retentionDays.value) || 90);
}

function renderTrackingNote(overview) {
  if (!overview?.tracking_started_at) {
    ui.trackingNote.textContent = `v${VERSION} · Analytics autoritaires`;
    return;
  }
  ui.trackingNote.textContent = `Suivi quotidien / temps de jeu depuis le ${formatDateTime(overview.tracking_started_at)} UTC · les compteurs lifetime antérieurs restent conservés.`;
}

function renderOverview(overview, daily) {
  currentOverview = overview;
  currentDaily = daily;
  renderTrackingNote(overview);

  setText('#kpi-players', formatNumber(overview.total_players));
  setText('#kpi-new-players', `${formatNumber(overview.new_players)} nouveaux`);
  setText('#kpi-active', formatNumber(overview.active_players));
  setText('#kpi-audience', `DAU ${formatNumber(overview.dau)} · WAU ${formatNumber(overview.wau)} · MAU ${formatNumber(overview.mau)}`);
  setText('#kpi-runs', formatNumber(overview.window_verified_runs));
  setText('#kpi-runs-lifetime', `${formatNumber(overview.lifetime_verified_runs)} lifetime`);
  setText('#kpi-playtime', formatDurationTicks(overview.window_play_ticks));
  setText('#kpi-record', formatNumber(overview.global_best_score));
  setText('#kpi-average', `moy. ${formatDecimal(overview.lifetime_average_score)}`);
  setText('#kpi-verification', formatPercent(overview.verification_rate_pct));
  setText('#period-average', formatDecimal(overview.window_average_score));
  setText('#pending-now', formatNumber(overview.pending_issued));
  setText('#rejected-now', formatNumber(overview.retained_rejected));
  setText('#tracked-total', formatDurationTicks(overview.tracked_play_ticks_total));

  const top = number(overview.deaths_pipe_top);
  const bottom = number(overview.deaths_pipe_bottom);
  const ground = number(overview.deaths_ground);
  const totalDeaths = Math.max(1, top + bottom + ground);
  const deathRows = [
    ['#death-top', '#death-top-progress', top],
    ['#death-bottom', '#death-bottom-progress', bottom],
    ['#death-ground', '#death-ground-progress', ground],
  ];
  for (const [labelSelector, progressSelector, count] of deathRows) {
    const pct = count * 100 / totalDeaths;
    setText(labelSelector, `${formatNumber(count)} · ${formatPercent(pct)}`);
    document.querySelector(progressSelector).value = pct;
  }

  setText('#sys-starts', formatNumber(overview.run_start_requests));
  setText('#sys-issued', formatNumber(overview.issued_runs));
  setText('#sys-rejected', formatNumber(overview.rejected_runs));
  setText('#sys-expired', formatNumber(overview.expired_issued_runs));
  setText('#sys-rate', formatNumber(overview.rate_limited_requests));
  setText('#sys-pending-cap', formatNumber(overview.pending_limit_requests));

  renderLineChart(document.querySelector('#runs-chart'), daily, {
    valueKey: 'verified_runs',
    secondaryKey: 'issued_runs',
    label: 'Runs vérifiées',
    secondaryLabel: 'Tickets émis',
    valueFormatter: formatNumber,
  });
  renderBarChart(document.querySelector('#active-chart'), daily, {
    valueKey: 'active_players',
    label: 'Joueurs actifs par jour',
    valueFormatter: formatNumber,
  });
  renderLineChart(document.querySelector('#system-chart'), daily, {
    valueKey: 'issued_runs',
    secondaryKey: 'rejected_runs',
    label: 'Tickets émis',
    secondaryLabel: 'Runs rejetées',
    valueFormatter: formatNumber,
  });
}

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
    avatar.textContent = playerLabel(row).slice(0, 1).toUpperCase();
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
  ui.playersBody.replaceChildren();
  ui.playersEmpty.hidden = rows.length > 0;

  for (const row of rows) {
    const tr = document.createElement('tr');
    const pending = number(row.pending_issued);
    tr.append(
      createPlayerCell(row),
      td(row.global_rank ? `#${formatNumber(row.global_rank)}` : '—'),
      td(formatNumber(row.verified_runs_count)),
      td(formatNumber(row.best_score)),
      td(formatDecimal(row.average_score)),
      td(formatDurationTicks(row.tracked_play_ticks)),
      td(formatNumber(pending), pending >= 8 ? 'pending-warning' : ''),
      td(formatDateTime(row.last_verified_run_at)),
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
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  for (const row of rows) {
    const cohortTime = Date.parse(`${row.cohort_date}T00:00:00Z`);
    const ageDays = Math.floor((todayUtc - cohortTime) / 86400000);
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
    search: ui.playerSearch.value,
    sort: ui.playerSort.value,
    limit: 100,
  });
  renderPlayers(rows);
}

async function loadRetention() {
  if (!authorized) return;
  const rows = await analytics.fetchRetention(retentionDays());
  renderRetention(rows);
}

async function loadDashboard({ includeTables = true } = {}) {
  if (!authorized) return;
  const serial = ++loadSerial;
  const days = selectedDays();
  setStatus('Actualisation…');
  ui.refresh.disabled = true;

  try {
    const baseRequests = [analytics.fetchOverview(days), analytics.fetchDaily(days)];
    const tableRequests = includeTables
      ? [loadPlayers(), loadRetention()]
      : [];
    const [overview, daily] = await Promise.all(baseRequests);
    await Promise.all(tableRequests);
    if (serial !== loadSerial) return;
    if (!overview) throw new Error('Aucune donnée Analytics reçue.');
    renderOverview(overview, daily);
    setStatus(`Mis à jour à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}. Données journalières en UTC.`);
  } catch (error) {
    if (serial !== loadSerial) return;
    setStatus(error?.message || String(error), true);
  } finally {
    if (serial === loadSerial) ui.refresh.disabled = false;
  }
}

function activateSection(name) {
  for (const [sectionName, node] of ui.sections) {
    node.hidden = sectionName !== name;
  }
  for (const tab of ui.tabs) {
    tab.classList.toggle('active', tab.dataset.section === name);
  }
}

async function authorizeAndLoad() {
  showGate('Vérification de l’accès', 'Validation de ton compte administrateur côté Supabase…', { allowLogin: false });
  ui.signOut.hidden = false;
  try {
    authorized = await analytics.isAdmin();
    if (!authorized) {
      showGate(
        'Accès refusé',
        'Ce compte Discord est authentifié mais ne figure pas dans analytics_admins. Ajoute son UUID depuis le SQL Editor Supabase.',
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
    showGate('Erreur de connexion', state.error || 'Impossible de restaurer la session Discord.');
    return;
  }
  showGate('Connexion requise', 'Connecte-toi avec Discord. L’accès est ensuite contrôlé par une allow-list Supabase.');
}

ui.signIn.addEventListener('click', () => {
  try {
    auth.signInWithDiscord();
  } catch (error) {
    showGate('Connexion impossible', error?.message || String(error));
  }
});

ui.signOut.addEventListener('click', async () => {
  await auth.signOut();
  authorized = false;
  showGate('Connexion requise', 'Session fermée. Connecte-toi avec Discord pour accéder aux Analytics.');
});

ui.refresh.addEventListener('click', () => loadDashboard());
ui.windowDays.addEventListener('change', () => loadDashboard({ includeTables: false }));
ui.retentionDays.addEventListener('change', async () => {
  try {
    setStatus('Actualisation des cohortes…');
    await loadRetention();
    setStatus('Cohortes actualisées.');
  } catch (error) {
    setStatus(error?.message || String(error), true);
  }
});
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
for (const tab of ui.tabs) {
  tab.addEventListener('click', () => activateSection(tab.dataset.section));
}

activateSection('overview');
boot();
