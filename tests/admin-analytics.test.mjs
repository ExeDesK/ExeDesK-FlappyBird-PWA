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
