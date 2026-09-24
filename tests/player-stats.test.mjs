import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/005_player_stats.sql', import.meta.url);

async function migration() {
  return readFile(migrationUrl, 'utf8');
}

test('player_stats stores lifetime verified aggregates and authoritative death causes', async () => {
  const sql = await migration();

  assert.match(sql, /create table if not exists public\.player_stats/i);
  assert.match(sql, /verified_runs_count bigint not null/i);
  assert.match(sql, /total_score bigint not null/i);
  assert.match(sql, /best_score integer not null/i);
  assert.match(sql, /best_run_id uuid references public\.verified_runs\(run_id\)/i);
  assert.match(sql, /deaths_pipe_top bigint not null/i);
  assert.match(sql, /deaths_pipe_bottom bigint not null/i);
  assert.match(sql, /deaths_ground bigint not null/i);
  assert.match(sql, /deaths_pipe_top \+ deaths_pipe_bottom \+ deaths_ground = verified_runs_count/i);
});

test('player_stats backfill only derives data from authoritative verified_runs', async () => {
  const sql = await migration();

  assert.match(sql, /from public\.verified_runs as vr[\s\S]*where vr\.status = 'verified'/i);
  assert.match(sql, /sum\(v\.verified_score\)::bigint as total_score/i);
  assert.match(sql, /count\(\*\) filter \(where v\.collision = 'upper-pipe'\)/i);
  assert.match(sql, /count\(\*\) filter \(where v\.collision = 'lower-pipe'\)/i);
  assert.match(sql, /count\(\*\) filter \(where v\.collision = 'ground'\)/i);
  assert.match(sql, /on conflict \(player_id\) do nothing/i);
});

test('verified transition updates lifetime stats once inside the database', async () => {
  const sql = await migration();

  assert.match(sql, /create or replace function public\.capture_verified_run_player_stats\(\)/i);
  assert.match(sql, /new\.verified_score/i);
  assert.match(sql, /new\.collision/i);
  assert.match(sql, /new\.resolved_at/i);
  assert.match(sql, /after update of status on public\.verified_runs/i);
  assert.match(sql, /new\.status = 'verified' and old\.status is distinct from 'verified'/i);
  assert.match(sql, /verified_runs_count = ps\.verified_runs_count \+ 1/i);
  assert.match(sql, /total_score = ps\.total_score \+ excluded\.total_score/i);
});

test('browser roles cannot read or write player_stats directly', async () => {
  const sql = await migration();

  assert.match(sql, /alter table public\.player_stats enable row level security/i);
  assert.match(sql, /revoke all on table public\.player_stats from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete).*player_stats.*\b(anon|authenticated)\b/i);
  assert.match(sql, /revoke all on function public\.capture_verified_run_player_stats\(\) from public, anon, authenticated/i);
});

test('player_stats preserves the deterministic best-run tie-break used by the leaderboard', async () => {
  const sql = await migration();

  assert.match(sql, /order by[\s\S]*v\.player_id,[\s\S]*v\.verified_score desc,[\s\S]*v\.resolved_at asc,[\s\S]*v\.run_id asc/i);
  assert.match(sql, /excluded\.best_score > ps\.best_score/i);
  assert.match(sql, /excluded\.best_score = ps\.best_score[\s\S]*excluded\.best_score_at < ps\.best_score_at/i);
  assert.match(sql, /excluded\.best_score_at = ps\.best_score_at[\s\S]*excluded\.best_run_id < ps\.best_run_id/i);
});
