import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/006_verified_run_retention.sql', import.meta.url);

async function migration() {
  return readFile(migrationUrl, 'utf8');
}

test('retention keeps the 50 most recently started verified runs', async () => {
  const sql = await migration();

  assert.match(sql, /where vr\.player_id = target_player_id\s+and vr\.status = 'verified'[\s\S]*order by vr\.issued_at desc, vr\.run_id desc\s+limit 50/i);
});

test('retention always preserves the deterministic historical best run', async () => {
  const sql = await migration();

  assert.match(sql, /historical_best as \([\s\S]*vr\.verified_score desc,[\s\S]*vr\.resolved_at asc,[\s\S]*vr\.run_id asc[\s\S]*limit 1/i);
  assert.match(sql, /keep_runs as \([\s\S]*select rr\.run_id from recent_runs[\s\S]*union[\s\S]*select hb\.run_id from historical_best/i);
});

test('retention deletes only verified rows and never issued/rejected tickets', async () => {
  const sql = await migration();

  assert.match(sql, /delete from public\.verified_runs as vr[\s\S]*vr\.player_id = target_player_id[\s\S]*vr\.status = 'verified'/i);
  assert.doesNotMatch(sql, /delete from public\.verified_runs[\s\S]*status\s+in\s*\([^)]*issued/i);
  assert.doesNotMatch(sql, /delete from public\.verified_runs[\s\S]*status\s+in\s*\([^)]*rejected/i);
});

test('retention is serialized per player and runs only after a run becomes verified', async () => {
  const sql = await migration();

  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /after update of status on public\.verified_runs/i);
  assert.match(sql, /new\.status = 'verified' and old\.status is distinct from 'verified'/i);
  assert.match(sql, /zz_verified_run_retention_on_update/i);
});

test('retention maintenance functions are not executable by browser roles', async () => {
  const sql = await migration();

  assert.match(sql, /revoke all on function public\.prune_verified_runs_for_player\(uuid\)[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.prune_verified_runs_for_player\(uuid\)[\s\S]*to service_role/i);
  assert.match(sql, /revoke all on function public\.prune_verified_runs_after_verification\(\)[\s\S]*from public, anon, authenticated/i);
});

test('migration prunes already-existing verified histories once', async () => {
  const sql = await migration();

  assert.match(sql, /select distinct vr\.player_id[\s\S]*where vr\.status = 'verified'/i);
  assert.match(sql, /perform public\.prune_verified_runs_for_player\(target_player_id\)/i);
});
