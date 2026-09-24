import { applyGeneratedAvatarFallback } from '../ui/avatar-fallback.js';
import { renderLineChart } from './charts.js';

function detailNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function setPlayerDetailText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function collisionLabel(value) {
  if (value === 'upper-pipe') return 'Pipe haut';
  if (value === 'lower-pipe') return 'Pipe bas';
  if (value === 'ground') return 'Sol';
  return value || '—';
}

function providerLabel(provider) {
  if (provider === 'discord') return 'Discord';
  if (provider === 'google') return 'Google';
  if (provider === 'email') return 'E-mail';
  return String(provider || 'Inconnu');
}

function booleanRetention(value) {
  if (value === null || value === undefined) return { label: 'À venir', className: 'pending' };
  return value
    ? { label: 'Actif', className: 'active' }
    : { label: 'Absent', className: 'inactive' };
}

export class PlayerDetailPanel {
  constructor({ analytics, formatters = {} } = {}) {
    this.analytics = analytics;
    this.dialog = document.getElementById('player-detail-dialog');
    this.content = document.getElementById('player-detail-content');
    this.status = document.getElementById('player-detail-status');
    this.avatar = document.getElementById('player-detail-avatar');
    this.currentPlayerId = null;
    this.serial = 0;
    this.formatNumber = formatters.number || (value => String(value ?? '—'));
    this.formatDecimal = formatters.decimal || this.formatNumber;
    this.formatDurationTicks = formatters.durationTicks || this.formatNumber;
    this.formatDateTime = formatters.dateTime || (value => String(value || '—'));
    this.formatDate = formatters.date || (value => String(value || '—'));

    document.getElementById('player-detail-close')?.addEventListener('click', () => this.close());
    this.dialog?.addEventListener('cancel', event => {
      event.preventDefault();
      this.close();
    });
  }

  close() {
    this.serial += 1;
    this.currentPlayerId = null;
    if (this.dialog?.open) this.dialog.close();
  }

  async open(row, range) {
    const playerId = row?.player_id;
    if (!playerId || !this.dialog) return;

    this.currentPlayerId = playerId;
    const serial = ++this.serial;
    this.content.hidden = true;
    this.status.textContent = 'Chargement de la fiche joueur…';
    this.status.classList.remove('error');
    setPlayerDetailText('player-detail-name', row.display_name || row.username || String(playerId).slice(0, 8));
    setPlayerDetailText('player-detail-subtitle', `${playerId} · ${this.formatDate(range?.from)} → ${this.formatDate(range?.to)}`);
    this.renderAvatar(row.avatar_url, row.display_name || row.username || String(playerId).slice(0, 8));

    if (!this.dialog.open) this.dialog.showModal();

    try {
      const detail = await this.analytics.fetchPlayerDetail({
        playerId,
        from: range?.from,
        to: range?.to,
      });
      if (serial !== this.serial || !this.dialog.open) return;
      if (!detail?.profile) throw new Error('Fiche joueur indisponible.');
      this.render(detail);
      this.status.textContent = '';
      this.content.hidden = false;
    } catch (error) {
      if (serial !== this.serial) return;
      this.status.textContent = error?.message || String(error);
      this.status.classList.add('error');
    }
  }

  renderAvatar(url, label) {
    this.avatar.replaceChildren();
    if (url) {
      const image = document.createElement('img');
      image.src = url;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      this.avatar.append(image);
      return;
    }
    const fallback = document.createElement('div');
    fallback.className = 'player-detail-avatar-fallback generated-avatar';
    applyGeneratedAvatarFallback(fallback, label);
    this.avatar.append(fallback);
  }

  render(detail) {
    const profile = detail.profile || {};
    const lifetime = detail.lifetime || {};
    const period = detail.period || {};
    const pending = detail.pending || {};

    const label = profile.display_name || profile.username || String(profile.player_id || '').slice(0, 8);
    setPlayerDetailText('player-detail-name', label);
    setPlayerDetailText('player-detail-subtitle', `${profile.player_id} · ${this.formatDate(detail.selected_from)} → ${this.formatDate(detail.selected_to)}`);
    this.renderAvatar(profile.avatar_url, label);

    setPlayerDetailText('pd-id', profile.player_id || '—');
    setPlayerDetailText('pd-created', this.formatDateTime(profile.created_at));
    setPlayerDetailText('pd-last-signin', this.formatDateTime(profile.last_sign_in_at));
    setPlayerDetailText('pd-avatar-provider', profile.avatar_provider ? providerLabel(profile.avatar_provider) : 'Fallback / aucun');

    setPlayerDetailText('pd-rank', lifetime.global_rank ? `#${this.formatNumber(lifetime.global_rank)}` : '—');
    setPlayerDetailText('pd-lifetime-runs', this.formatNumber(lifetime.verified_runs));
    setPlayerDetailText('pd-lifetime-best', lifetime.best_score === null || lifetime.best_score === undefined ? '—' : this.formatNumber(lifetime.best_score));
    setPlayerDetailText('pd-lifetime-average', this.formatDecimal(lifetime.average_score));
    setPlayerDetailText('pd-lifetime-playtime', this.formatDurationTicks(lifetime.tracked_play_ticks));
    setPlayerDetailText('pd-lifetime-run-time', lifetime.tracked_verified_runs > 0 ? this.formatDurationTicks(lifetime.average_run_ticks_tracked) : '—');
    setPlayerDetailText('pd-lifetime-active-days', this.formatNumber(lifetime.tracked_active_days));

    setPlayerDetailText('pd-period-runs', this.formatNumber(period.verified_runs));
    setPlayerDetailText('pd-period-best', detailNumber(period.verified_runs) > 0 ? this.formatNumber(period.best_score) : '—');
    setPlayerDetailText('pd-period-average', detailNumber(period.verified_runs) > 0 ? this.formatDecimal(period.average_score) : '—');
    setPlayerDetailText('pd-period-playtime', this.formatDurationTicks(period.play_ticks));
    setPlayerDetailText('pd-period-run-time', detailNumber(period.verified_runs) > 0 ? this.formatDurationTicks(period.average_run_ticks) : '—');
    setPlayerDetailText('pd-period-active-days', this.formatNumber(period.active_days));
    setPlayerDetailText('pd-period-day-time', detailNumber(period.active_days) > 0 ? this.formatDurationTicks(period.average_play_ticks_per_active_day) : '—');

    setPlayerDetailText('pd-death-top', this.formatNumber(lifetime.deaths_pipe_top));
    setPlayerDetailText('pd-death-bottom', this.formatNumber(lifetime.deaths_pipe_bottom));
    setPlayerDetailText('pd-death-ground', this.formatNumber(lifetime.deaths_ground));
    setPlayerDetailText('pd-pending', `${this.formatNumber(pending.issued)} pending · ${this.formatNumber(pending.rejected)} rejetées retenues`);

    this.renderIdentities(detail.identities || []);
    this.renderRetention(detail.retention || {});
    this.renderActivity(detail.activity || []);
    this.renderRuns(detail.recent_runs || []);
  }

  renderIdentities(identities) {
    const container = document.getElementById('pd-identities');
    container.replaceChildren();
    if (!identities.length) {
      const empty = document.createElement('p');
      empty.className = 'muted compact';
      empty.textContent = 'Aucune identité OAuth liée trouvée.';
      container.append(empty);
      return;
    }

    for (const identity of identities) {
      const item = document.createElement('div');
      item.className = 'identity-item';
      const provider = document.createElement('strong');
      provider.textContent = providerLabel(identity.provider);
      const meta = document.createElement('span');
      const name = identity.provider_label ? ` · ${identity.provider_label}` : '';
      meta.textContent = `Lié ${this.formatDateTime(identity.linked_at)}${name}`;
      const last = document.createElement('small');
      last.textContent = `Dernière connexion : ${this.formatDateTime(identity.last_sign_in_at)}`;
      item.append(provider, meta, last);
      container.append(item);
    }
  }

  renderRetention(retention) {
    const container = document.getElementById('pd-retention');
    container.replaceChildren();
    for (const key of ['d0', 'd1', 'd7', 'd30']) {
      const state = booleanRetention(retention[key]);
      const item = document.createElement('div');
      item.className = `retention-badge ${state.className}`;
      const label = document.createElement('strong');
      label.textContent = key.toUpperCase();
      const value = document.createElement('span');
      value.textContent = state.label;
      item.append(label, value);
      container.append(item);
    }
  }

  renderActivity(rows) {
    renderLineChart(document.getElementById('pd-activity-chart'), rows, {
      valueKey: 'verified_runs',
      secondaryKey: 'best_score',
      label: 'Runs',
      secondaryLabel: 'Record quotidien',
      valueFormatter: value => this.formatNumber(value),
    });
  }

  renderRuns(rows) {
    const body = document.getElementById('pd-runs-body');
    const empty = document.getElementById('pd-runs-empty');
    body.replaceChildren();
    empty.hidden = rows.length > 0;

    for (const run of rows) {
      const tr = document.createElement('tr');
      const values = [
        this.formatDateTime(run.resolved_at || run.issued_at),
        run.status || '—',
        run.score === null || run.score === undefined ? '—' : this.formatNumber(run.score),
        run.terminal_tick === null || run.terminal_tick === undefined ? '—' : this.formatDurationTicks(run.terminal_tick),
        collisionLabel(run.collision),
        run.theme ? `${run.theme}${run.variant ? ` · ${run.variant}` : ''}` : 'Legacy / aléatoire',
      ];
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = value;
        tr.append(cell);
      }
      body.append(tr);
    }
  }
}
