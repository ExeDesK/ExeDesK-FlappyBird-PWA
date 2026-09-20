import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MAX_VERIFIED_RUN_TICK,
  PHYSICS_VERSION,
  RUN_RESULT_SCHEMA,
  RUN_TICKET_SCHEMA,
  VERIFIED_RUN_SCHEMA,
  createCanonicalRunGame,
  createVerifiedRunSubmission,
  parseRunTicket,
  parseVerifiedRunResult,
  parseVerifiedRunSubmission,
  simulateVerifiedRun,
} from '../site/src/verified-runs.js';

const RUN_ID = '123e4567-e89b-12d3-a456-426614174000';

const GOLDEN_RUNS = [
  {
    seed: 42,
    rng: [553523280, 1293697844],
    taps: [0],
    terminal_tick: 53,
    score: 0,
    collision: 'ground',
  },
  {
    seed: -9876543,
    rng: [243217936, 751066192],
    taps: [0, 35, 70, 105, 141, 176, 212, 247, 271, 295, 330, 369, 405, 453, 488, 512, 545, 579, 614, 650, 691, 727, 764, 799, 836, 871, 915],
    terminal_tick: 953,
    score: 10,
    collision: 'lower-pipe',
  },
  {
    seed: 123456789,
    rng: [118540483, -1911680585],
    taps: [0, 18, 36, 54, 72, 90, 108, 126, 144, 162, 180],
    terminal_tick: 224,
    score: 0,
    collision: 'upper-pipe',
  },
  {
    seed: 987654321,
    rng: [729893710, 1486768404],
    taps: [0, 35, 66, 95, 131, 166, 202, 237, 281, 316, 340, 364, 398, 429, 465, 509, 544, 576, 611, 647, 698, 733, 763, 798, 837, 872, 896, 920, 944, 990, 1025, 1070, 1105, 1132, 1168, 1203, 1240, 1276, 1306, 1341, 1365, 1389, 1424, 1470, 1506, 1530, 1554, 1584, 1626, 1661, 1695],
    terminal_tick: 1733,
    score: 20,
    collision: 'lower-pipe',
  },
];

test('run tickets accept only the versioned server contract', () => {
  const ticket = parseRunTicket({
    schema: RUN_TICKET_SCHEMA,
    run_id: RUN_ID.toUpperCase(),
    seed: -2147483648,
    physics_version: PHYSICS_VERSION,
    issued_at: '2026-09-20T18:00:00.000Z',
  });

  assert.deepEqual(ticket, {
    schema: RUN_TICKET_SCHEMA,
    run_id: RUN_ID,
    seed: -2147483648,
    physics_version: PHYSICS_VERSION,
    issued_at: '2026-09-20T18:00:00.000Z',
  });
  assert.equal(Object.isFrozen(ticket), true);

  assert.throws(
    () => parseRunTicket({ ...ticket, physics_version: '0.2.7.2b' }),
    /physics_version non supportée/,
  );
  assert.throws(() => parseRunTicket({ ...ticket, seed: 2147483648 }), /32 bits/);
  assert.throws(() => parseRunTicket({ ...ticket, run_id: 'not-a-uuid' }), /run_id/);
});

test('verified submission contract contains no client-owned seed or score', () => {
  const submission = createVerifiedRunSubmission({
    run_id: RUN_ID,
    physics_version: PHYSICS_VERSION,
    terminal_tick: 53,
    taps: [0, 17, 42],
    seed: 123,
    score: 999999,
  });

  assert.deepEqual(submission, {
    schema: VERIFIED_RUN_SCHEMA,
    run_id: RUN_ID,
    physics_version: PHYSICS_VERSION,
    terminal_tick: 53,
    taps: [0, 17, 42],
  });
  assert.equal(Object.isFrozen(submission.taps), true);

  assert.throws(
    () => createVerifiedRunSubmission({ ...submission, taps: [1] }),
    /tick 0/,
  );
  assert.throws(
    () => createVerifiedRunSubmission({ ...submission, taps: [0, 17, 17] }),
    /strictement croissants/,
  );
  assert.throws(
    () => createVerifiedRunSubmission({ ...submission, terminal_tick: MAX_VERIFIED_RUN_TICK + 1 }),
    /doit être compris/,
  );

  assert.deepEqual(parseVerifiedRunSubmission(submission), submission);
  assert.throws(
    () => parseVerifiedRunSubmission({ ...submission, score: 999999 }),
    /champ réservé au serveur/,
  );
});

test('verified run results accept coherent verified and rejected outcomes only', () => {
  const verified = parseVerifiedRunResult({
    schema: RUN_RESULT_SCHEMA,
    run_id: RUN_ID,
    physics_version: PHYSICS_VERSION,
    status: 'verified',
    terminal_tick: 53,
    score: 0,
    collision: 'ground',
    rejection_code: null,
    resolved_at: '2026-09-20T20:00:00.000Z',
    idempotent: false,
  });
  assert.equal(verified.status, 'verified');
  assert.equal(verified.score, 0);

  const rejected = parseVerifiedRunResult({
    ...verified,
    status: 'rejected',
    score: null,
    collision: null,
    rejection_code: 'early_collision',
  });
  assert.equal(rejected.status, 'rejected');

  assert.throws(
    () => parseVerifiedRunResult({ ...verified, score: 999, collision: null }),
    /incohérent/,
  );
});

test('canonical start reproduces all four APK harness START states', () => {
  for (const expected of GOLDEN_RUNS) {
    const { game, warmupFrames } = createCanonicalRunGame({ seed: expected.seed });

    assert.equal(warmupFrames, 89, `seed ${expected.seed}`);
    assert.equal(game.state, 'READY', `seed ${expected.seed}`);
    assert.equal(game.score, 0, `seed ${expected.seed}`);
    assert.deepEqual([game.random.y, game.random.z], expected.rng, `seed ${expected.seed}`);
    assert.deepEqual(game.pipes.map(({ x, y }) => ({ x, y })), [
      { x: 79, y: 274 },
      { x: 236, y: 274 },
      { x: 393, y: 274 },
    ]);
  }
});

test('authoritative replay core matches the four APK golden terminal results', () => {
  for (const expected of GOLDEN_RUNS) {
    const result = simulateVerifiedRun(expected);

    assert.equal(result.terminal_tick, expected.terminal_tick, `seed ${expected.seed}`);
    assert.equal(result.score, expected.score, `seed ${expected.seed}`);
    assert.equal(result.collision, expected.collision, `seed ${expected.seed}`);
    assert.equal(result.snapshot.state, 'DYING', `seed ${expected.seed}`);
  }
});

test('authoritative replay rejects an early collision and a false terminal tick', () => {
  assert.throws(
    () => simulateVerifiedRun({ seed: 42, taps: [0], terminal_tick: 54 }),
    /Collision prématurée au tick 53/,
  );
  assert.throws(
    () => simulateVerifiedRun({ seed: 42, taps: [0], terminal_tick: 52 }),
    /ne se termine pas/,
  );
});

test('verified-runs migration is private and reserves one authoritative result per run_id', async () => {
  const sql = await readFile(new URL('../supabase/003_verified_runs.sql', import.meta.url), 'utf8');

  assert.match(sql, /run_id uuid primary key default gen_random_uuid\(\)/i);
  assert.match(sql, /player_id uuid not null references auth\.users\(id\) on delete cascade/i);
  assert.match(sql, /status in \('issued', 'verified', 'rejected'\)/i);
  assert.match(sql, /terminal_tick between 0 and 216000/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.verified_runs from public, anon, authenticated/i);
  assert.match(sql, /grant usage on schema public to service_role/i);
  assert.match(
    sql,
    /grant select, insert, update on table public\.verified_runs to service_role/i,
  );
  assert.match(sql, /notify pgrst, 'reload schema'/i);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete).*verified_runs.*authenticated/i);
});

test('run-start authenticates the caller and generates the seed on the server', async () => {
  const source = await readFile(
    new URL('../supabase/functions/run-start/index.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /withSupabase\(\{ auth: 'user' \}/);
  assert.match(source, /context\.userClaims\?\.id/);
  assert.match(source, /context\.supabaseAdmin/);
  assert.match(source, /crypto\.getRandomValues/);
  assert.match(source, new RegExp(`PHYSICS_VERSION = '${PHYSICS_VERSION}'`));
  assert.match(source, new RegExp(`RUN_TICKET_SCHEMA = '${RUN_TICKET_SCHEMA}'`));
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /request\.json\(\).*seed/s);
});
