import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/009_verified_run_ticket_hygiene.sql', import.meta.url);

async function migration() {
  return readFile(migrationUrl, 'utf8');
}

test('ticket hygiene expires abandoned issued and old rejected rows without touching verified retention', async () => {
  const sql = await migration();

  assert.match(sql, /vr\.status = 'issued'[\s\S]*vr\.issued_at < cleanup_now - interval '7 days'/i);
  assert.match(sql, /vr\.status = 'rejected'[\s\S]*vr\.resolved_at < cleanup_now - interval '30 days'/i);
  assert.doesNotMatch(sql, /delete from public\.verified_runs as vr[\s\S]{0,180}vr\.status = 'verified'/i);
});

test('ticket hygiene installs partial indexes for both cleanup windows', async () => {
  const sql = await migration();

  assert.match(sql, /verified_runs_issued_cleanup_idx[\s\S]*\(issued_at\)[\s\S]*where status = 'issued'/i);
  assert.match(sql, /verified_runs_rejected_cleanup_idx[\s\S]*\(resolved_at\)[\s\S]*where status = 'rejected'/i);
});

test('run issuance is serialized per player and capped at 10 unresolved issued tickets', async () => {
  const sql = await migration();

  assert.match(sql, /create or replace function public\.issue_verified_run/i);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*hashtextextended\(target_player_id::text, 636\)/i);
  assert.match(sql, /where vr\.player_id = target_player_id[\s\S]*vr\.status = 'issued'[\s\S]*if open_issued >= 10/i);
  assert.match(sql, /'too_many_pending_runs'::text/i);
});

test('run issuance enforces a rolling 30 starts per minute rate limit across statuses', async () => {
  const sql = await migration();

  assert.match(sql, /where vr\.player_id = target_player_id[\s\S]*vr\.issued_at > issue_now - interval '1 minute'/i);
  assert.match(sql, /if starts_last_minute >= 30/i);
  assert.match(sql, /'rate_limited'::text/i);
  assert.match(sql, /retry_after_seconds integer/i);
});

test('run issuance opportunistically removes this player stale issued tickets before applying the cap', async () => {
  const sql = await migration();

  const staleDelete = sql.indexOf("vr.issued_at < issue_now - interval '7 days'");
  const pendingCheck = sql.indexOf('if open_issued >= 10');
  assert.ok(staleDelete >= 0, 'per-player stale issued cleanup should exist');
  assert.ok(pendingCheck > staleDelete, 'cleanup should happen before the pending-ticket cap');
});

test('ticket maintenance functions remain server-only', async () => {
  const sql = await migration();

  assert.match(sql, /revoke all on function public\.cleanup_stale_verified_run_tickets\(\)[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.cleanup_stale_verified_run_tickets\(\)[\s\S]*to service_role/i);
  assert.match(sql, /revoke all on function public\.issue_verified_run\(uuid, integer, text\)[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.issue_verified_run\(uuid, integer, text\)[\s\S]*to service_role/i);
});

test('Supabase Cron runs ticket hygiene hourly and the migration cleans legacy rows once', async () => {
  const sql = await migration();

  assert.match(sql, /create extension if not exists pg_cron/i);
  assert.match(sql, /select \* from public\.cleanup_stale_verified_run_tickets\(\)/i);
  assert.match(sql, /cron\.schedule\([\s\S]*'flappy13-verified-run-ticket-hygiene'[\s\S]*'17 \* \* \* \*'[\s\S]*cleanup_stale_verified_run_tickets/i);
});
