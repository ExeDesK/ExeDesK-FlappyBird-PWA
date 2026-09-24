import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sql = read('supabase/010_admin_analytics.sql');
const client = read('site/src/admin/analytics-client.js');
const dashboard = read('site/src/admin/dashboard.js');
const html = read('site/admin/index.html');
const css = read('site/admin/admin.css');

function functionBlock(name, nextName = null) {
  const start = sql.indexOf(`function public.${name}`);
  assert.ok(start >= 0, `missing function ${name}`);
  const end = nextName ? sql.indexOf(`function public.${nextName}`, start + 1) : sql.length;
  return sql.slice(start, end >= 0 ? end : sql.length);
}

test('analytics migration stores private daily aggregates and starts tracking without fake historical backfill', () => {
  assert.match(sql, /create table if not exists public\.analytics_admins/i);
  assert.match(sql, /create table if not exists public\.analytics_meta/i);
  assert.match(sql, /create table if not exists public\.player_activity_daily/i);
  assert.match(sql, /create table if not exists public\.run_metrics_daily/i);
  assert.match(sql, /add column if not exists tracked_play_ticks bigint not null default 0/i);
  assert.match(sql, /tracking_started_at timestamptz not null default now\(\)/i);
  assert.match(sql, /as dau[\s\S]*as wau[\s\S]*as mau/i);
  assert.doesNotMatch(sql, /insert into public\.player_activity_daily\s*\([^)]*\)\s*select/i);
  assert.match(sql, /revoke all on table public\.player_activity_daily from public, anon, authenticated/i);
  assert.match(sql, /revoke all on table public\.run_metrics_daily from public, anon, authenticated/i);
  assert.match(sql, /revoke all on table public\.analytics_admins from public, anon, authenticated/i);
});

test('verified transitions accumulate authoritative play time and daily activity before detailed retention can prune rows', () => {
  const block = functionBlock('capture_verified_run_player_stats', 'capture_rejected_run_analytics');
  assert.match(block, /run_ticks := greatest\(coalesce\(new\.terminal_tick, 0\), 0\)::bigint/i);
  assert.match(block, /tracked_play_ticks = ps\.tracked_play_ticks \+ excluded\.tracked_play_ticks/i);
  assert.match(block, /insert into public\.player_activity_daily/i);
  assert.match(block, /delta_verified_runs => 1/i);
  assert.match(block, /delta_play_ticks => run_ticks/i);
  assert.match(block, /candidate_best_score => new\.verified_score/i);
});

test('ticket lifecycle metrics survive cleanup and run-start keeps the hardened 009 contract', () => {
  const cleanup = functionBlock('cleanup_stale_verified_run_tickets', 'issue_verified_run');
  const issue = functionBlock('issue_verified_run', 'is_analytics_admin');
  assert.match(cleanup, /status = 'issued'[\s\S]*interval '7 days'/i);
  assert.match(cleanup, /status = 'rejected'[\s\S]*interval '30 days'/i);
  assert.match(cleanup, /delta_expired_issued_runs => issued_count/i);
  assert.match(cleanup, /delta_purged_rejected_runs => rejected_count/i);
  assert.match(issue, /pg_advisory_xact_lock/i);
  assert.match(issue, /open_issued >= 10/i);
  assert.match(issue, /starts_last_minute >= 30/i);
  assert.match(issue, /delta_run_start_requests => 1/i);
  assert.match(issue, /delta_pending_limit_requests => 1/i);
  assert.match(issue, /delta_rate_limited_requests => 1/i);
  assert.match(issue, /delta_issued_runs => 1/i);
  assert.match(issue, /delta_expired_issued_runs => expired_for_player/i);
});

test('daily analytics exposes coherent rolling audience fields for the chart window', () => {
  const block = functionBlock('admin_analytics_daily', 'admin_analytics_players');
  assert.match(block, /active_players bigint,[\s\S]*dau bigint,[\s\S]*wau bigint,[\s\S]*mau bigint/i);
  assert.match(block, /coalesce\(a\.active_players, 0\)::bigint as dau/i);
  assert.match(block, /activity_date between d\.activity_date - 6 and d\.activity_date/i);
  assert.match(block, /activity_date between d\.activity_date - 29 and d\.activity_date/i);
});

test('admin analytics RPCs are allow-listed and never expose private tables directly to browser roles', () => {
  assert.match(sql, /create or replace function public\.is_analytics_admin\(\)/i);
  assert.match(sql, /where aa\.user_id = auth\.uid\(\)/i);
  assert.match(sql, /create or replace function public\.require_analytics_admin\(\)/i);
  for (const name of [
    'admin_analytics_overview',
    'admin_analytics_daily',
    'admin_analytics_players',
    'admin_analytics_retention',
  ]) {
    const block = functionBlock(name);
    assert.match(block, /perform public\.require_analytics_admin\(\)/i, `${name} must require admin`);
  }
  assert.match(sql, /grant execute on function public\.admin_analytics_overview\(integer\) to authenticated, service_role/i);
  assert.doesNotMatch(sql, /grant (?:select|insert|update|delete|all)[^;]*public\.analytics_admins[^;]*authenticated/i);
});

test('retention cohorts start at analytics tracking date and use verified daily activity for D0 D1 D7 D30', () => {
  const block = functionBlock('admin_analytics_retention');
  assert.match(block, /tracking_started_at at time zone 'UTC'/i);
  assert.match(block, /player_activity_daily/i);
  assert.match(block, /cohort_date \+ 1/i);
  assert.match(block, /cohort_date \+ 7/i);
  assert.match(block, /cohort_date \+ 30/i);
  assert.match(block, /cohort_date <= current_date - 30/i);
});

test('admin dashboard uses the existing OAuth session with authenticated RPCs and no server secret', () => {
  assert.match(html, /<script src="\.\.\/config\.js"><\/script>/);
  assert.match(html, /src="\.\.\/src\/admin\/dashboard\.js"/);
  assert.match(dashboard, /new AuthClient/);
  assert.match(dashboard, /signInWithDiscord/);
  assert.match(dashboard, /signInWithProvider\('google'\)/);
  assert.match(html, /sign-in-discord/);
  assert.match(html, /sign-in-google/);
  assert.match(dashboard, /new AnalyticsClient/);
  assert.match(client, /is_analytics_admin/);
  assert.match(client, /admin_analytics_overview/);
  assert.match(client, /admin_analytics_daily/);
  assert.match(client, /admin_analytics_players/);
  assert.match(client, /admin_analytics_retention/);
  assert.match(client, /supabaseHeaders\(this\.publishableKey, token\)/);
  assert.doesNotMatch(`${client}\n${dashboard}\n${html}`, /service_role|sb_secret_/i);
  assert.doesNotMatch(html, /https:\/\/cdn\.|chart\.js/i);
  assert.match(css, /color-scheme:\s*dark/i);
});

test('admin player rows read the live profile identity instead of a duplicated profile snapshot', () => {
  const block = functionBlock('admin_analytics_players', 'admin_analytics_retention');
  assert.match(block, /left join public\.profiles as p on p\.id = r\.player_id/i);
  assert.match(block, /p\.display_name/i);
  assert.match(block, /p\.avatar_url/i);
  assert.doesNotMatch(block, /cached_display_name|cached_avatar_url/i);
});

const rangeSql = read('supabase/017_admin_analytics_ranges.sql');

function rangeFunctionBlock(name, nextName = null) {
  const start = rangeSql.indexOf(`function public.${name}`);
  assert.ok(start >= 0, `missing range function ${name}`);
  const end = nextName ? rangeSql.indexOf(`function public.${nextName}`, start + 1) : rangeSql.length;
  return rangeSql.slice(start, end >= 0 ? end : rangeSql.length);
}

test('range analytics migration exposes admin-only inclusive UTC from/to RPCs', () => {
  for (const name of [
    'admin_analytics_overview_range',
    'admin_analytics_daily_range',
    'admin_analytics_players_range',
    'admin_analytics_retention_range',
  ]) {
    const block = rangeFunctionBlock(name);
    assert.match(block, /perform public\.require_analytics_admin\(\)/i, `${name} must require admin`);
  }
  assert.match(rangeSql, /date_from date default null[\s\S]*date_to date default null/i);
  assert.match(rangeSql, /statement_timestamp\(\) at time zone 'UTC'/i);
  assert.match(rangeSql, /analytics_invalid_date_range/i);
  assert.match(rangeSql, /analytics_date_range_too_large/i);
  assert.match(rangeSql, /days_count > 3650/i);
  assert.doesNotMatch(rangeSql, /grant execute[^;]* to anon/i);
});

test('range overview computes historical audience as of selected end date and richer period KPIs', () => {
  const block = rangeFunctionBlock('admin_analytics_overview_range', 'admin_analytics_daily_range');
  assert.match(block, /selected_from date,[\s\S]*selected_to date,[\s\S]*selected_days integer/i);
  assert.match(block, /new_active_players bigint,[\s\S]*returning_active_players bigint/i);
  assert.match(block, /period_best_score integer/i);
  assert.match(block, /runs_per_active_player numeric/i);
  assert.match(block, /play_ticks_per_active_player numeric/i);
  assert.match(block, /where pad\.activity_date = end_date/i);
  assert.match(block, /between end_date - 6 and end_date/i);
  assert.match(block, /between end_date - 29 and end_date/i);
  assert.match(block, /issue_rate_pct numeric,[\s\S]*verification_rate_pct numeric,[\s\S]*rejection_rate_pct numeric/i);
});

test('range player analytics aggregate activity only inside the selected period while preserving lifetime context', () => {
  const block = rangeFunctionBlock('admin_analytics_players_range', 'admin_analytics_retention_range');
  assert.match(block, /where pad\.activity_date between start_date and end_date/i);
  assert.match(block, /period_verified_runs bigint/i);
  assert.match(block, /period_best_score integer/i);
  assert.match(block, /period_play_ticks bigint/i);
  assert.match(block, /period_active_days bigint/i);
  assert.match(block, /lifetime_best_score integer/i);
  assert.match(block, /when sort_key in \('record', 'playtime', 'recent', 'runs', 'active_days'\)/i);
});

test('admin dashboard supports today, yesterday, quick ranges and explicit from/to dates', () => {
  assert.match(html, /data-period="today"[^>]*>Aujourd'hui</i);
  assert.match(html, /data-period="yesterday"[^>]*>Hier</i);
  assert.match(html, /id="period-from" type="date"/i);
  assert.match(html, /id="period-to" type="date"/i);
  assert.match(dashboard, /presetRange\('today'\)/i);
  assert.match(dashboard, /presetRange\('yesterday'\)/i);
  assert.match(dashboard, /validateRange/i);
  assert.match(dashboard, /MAX_RANGE_DAYS = 3650/i);
  assert.match(client, /admin_analytics_overview_range/i);
  assert.match(client, /admin_analytics_daily_range/i);
  assert.match(client, /admin_analytics_players_range/i);
  assert.match(client, /admin_analytics_retention_range/i);
});

test('richer admin overview exposes engagement, score, acquisition and system charts', () => {
  for (const id of [
    'playtime-chart',
    'score-chart',
    'kpi-active-split',
    'kpi-runs-per-player',
    'kpi-playtime-per-player',
    'kpi-acquisition',
    'period-peak-active',
    'period-peak-runs',
    'sys-verified',
    'sys-purged',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(dashboard, /period_verified_runs/i);
  assert.match(dashboard, /period_active_days/i);
  assert.match(css, /\.period-presets/i);
  assert.match(css, /\.kpi-grid-wide/i);
});

const insightsSql = read('supabase/018_admin_player_daily_insights.sql');
const dayView = read('site/src/admin/day-view.js');
const playerDetail = read('site/src/admin/player-detail.js');

function insightsFunctionBlock(name, nextName = null) {
  const start = insightsSql.indexOf(`function public.${name}`);
  assert.ok(start >= 0, `missing insights function ${name}`);
  const end = nextName ? insightsSql.indexOf(`function public.${nextName}`, start + 1) : insightsSql.length;
  return insightsSql.slice(start, end >= 0 ? end : insightsSql.length);
}

test('hourly analytics starts explicitly at migration 018 without inventing historical buckets', () => {
  assert.match(insightsSql, /add column if not exists hourly_tracking_started_at timestamptz/i);
  assert.match(insightsSql, /create table if not exists public\.player_activity_hourly/i);
  assert.match(insightsSql, /create table if not exists public\.run_metrics_hourly/i);
  assert.match(insightsSql, /revoke all on table public\.player_activity_hourly from public, anon, authenticated/i);
  assert.match(insightsSql, /revoke all on table public\.run_metrics_hourly from public, anon, authenticated/i);
  assert.doesNotMatch(insightsSql, /insert into public\.player_activity_hourly\s*\([^;]*\)\s*select/i);
});

test('authoritative verified transitions feed both daily and hourly gameplay aggregates', () => {
  const block = insightsFunctionBlock('capture_verified_run_player_stats', 'admin_analytics_player_detail');
  assert.match(block, /insert into public\.player_activity_daily/i);
  assert.match(block, /insert into public\.player_activity_hourly/i);
  assert.match(block, /activity_hour_utc := date_trunc\('hour', new\.resolved_at at time zone 'UTC'\)/i);
  assert.match(block, /deaths_pipe_top = pah\.deaths_pipe_top \+ excluded\.deaths_pipe_top/i);
  assert.match(block, /perform public\.bump_run_metrics/i);
});

test('hourly verified-run trigger avoids PL/pgSQL activity_hour ambiguity', () => {
  const block = insightsFunctionBlock('capture_verified_run_player_stats', 'admin_analytics_player_detail');
  assert.doesNotMatch(block, /declare[\s\S]*\n\s*activity_hour\s+timestamptz;/i);
  assert.match(block, /activity_hour_utc timestamptz;/i);
  assert.match(block, /on conflict \(player_id, activity_hour\) do update/i);
  assert.match(block, /new\.player_id,\s*activity_hour_utc,/i);

  const hotfix = read('supabase/021_hourly_activity_ambiguity.sql');
  assert.match(hotfix, /SQLSTATE 42702/i);
  assert.match(hotfix, /activity_hour_utc timestamptz;/i);
  assert.doesNotMatch(hotfix, /\n\s*activity_hour timestamptz;/i);
});

test('player drill-down is admin-only and exposes linked provider metadata without tokens or replay material', () => {
  const block = insightsFunctionBlock('admin_analytics_player_detail', 'admin_analytics_day_overview');
  assert.match(block, /perform public\.require_analytics_admin\(\)/i);
  assert.match(block, /from auth\.identities as i/i);
  assert.match(block, /'provider'[\s\S]*'linked_at'[\s\S]*'last_sign_in_at'/i);
  assert.match(block, /tracked_play_ticks/i);
  assert.match(block, /recent_runs/i);
  assert.doesNotMatch(block, /access_token|refresh_token/i);
  assert.doesNotMatch(block, /'seed'|'tap_ticks'|'taps'/i);
  assert.match(insightsSql, /revoke all on function public\.admin_analytics_player_detail\(uuid, date, date\) from public, anon/i);
});

test('dedicated day analytics exposes exact daily totals plus 24 UTC hourly buckets and operational peaks', () => {
  for (const name of ['admin_analytics_day_overview', 'admin_analytics_day_hourly', 'admin_analytics_day_recent_runs']) {
    const block = insightsFunctionBlock(name);
    assert.match(block, /perform public\.require_analytics_admin\(\)/i, `${name} must require admin`);
  }
  const hourly = insightsFunctionBlock('admin_analytics_day_hourly', 'admin_analytics_day_recent_runs');
  assert.match(hourly, /generate_series\(day_start, day_end - interval '1 hour', interval '1 hour'\)/i);
  assert.match(hourly, /active_players bigint/i);
  assert.match(hourly, /run_start_requests bigint/i);
  assert.match(hourly, /deaths_pipe_top bigint/i);
  assert.match(insightsSql, /grant execute on function public\.admin_analytics_day_hourly\(date\) to authenticated, service_role/i);
  assert.doesNotMatch(insightsSql, /grant execute[^;]*admin_analytics_day_(?:overview|hourly|recent_runs)[^;]*to anon/i);
});

test('admin UI offers clickable player drill-down with linked accounts and detailed play-time statistics', () => {
  assert.match(html, /id="player-detail-dialog"/i);
  assert.match(html, /IDENTITÉS LIÉES/i);
  assert.match(html, /Durée moyenne \/ run suivie/i);
  assert.match(html, /id="pd-activity-chart"/i);
  assert.match(dashboard, /new PlayerDetailPanel/i);
  assert.match(playerDetail, /fetchPlayerDetail/i);
  assert.match(playerDetail, /detail\.identities/i);
  assert.match(client, /admin_analytics_player_detail/i);
  assert.match(css, /\.player-detail-dialog/i);
});

test('admin UI includes a dedicated day page with hourly peaks, top players and retained-run inspection', () => {
  assert.match(html, /data-section="day"[^>]*>Journée</i);
  assert.match(html, /id="day-active-chart"/i);
  assert.match(html, /id="day-peak-active"/i);
  assert.match(html, /id="day-players-body"/i);
  assert.match(html, /id="day-runs-body"/i);
  assert.match(dayView, /fetchDayOverview/i);
  assert.match(dayView, /fetchDayHourly/i);
  assert.match(dayView, /fetchDayRecentRuns/i);
  assert.match(dayView, /hourLabel/i);
  assert.match(client, /admin_analytics_day_overview/i);
  assert.match(client, /admin_analytics_day_hourly/i);
  assert.match(client, /admin_analytics_day_recent_runs/i);
});
