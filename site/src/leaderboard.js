export const LEADERBOARD_MAX_ROWS = 100;

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseLeaderboardRows(payload, { maxRows = LEADERBOARD_MAX_ROWS } = {}) {
  if (!Array.isArray(payload)) {
    throw new Error('Invalid leaderboard response.');
  }

  const limit = Math.max(1, Math.min(Number(maxRows) || LEADERBOARD_MAX_ROWS, LEADERBOARD_MAX_ROWS));
  const rows = [];
  const players = new Set();

  for (const raw of payload.slice(0, limit)) {
    const rank = Number(raw?.rank);
    const score = Number(raw?.score);
    const achievedAt = typeof raw?.achieved_at === 'string' ? raw.achieved_at : '';
    const recordHeldSince = raw?.record_held_since == null
      ? null
      : String(raw.record_held_since);

    if (!Number.isInteger(rank) || rank < 1) {
      throw new Error('Invalid leaderboard rank.');
    }
    if (!isUuid(raw?.player_id) || players.has(raw.player_id)) {
      throw new Error('Invalid leaderboard player.');
    }
    if (!Number.isInteger(score) || score < 0 || score > 2147483647) {
      throw new Error('Invalid leaderboard score.');
    }
    if (!achievedAt || Number.isNaN(Date.parse(achievedAt))) {
      throw new Error('Invalid leaderboard timestamp.');
    }
    if (recordHeldSince !== null) {
      const heldSinceMs = Date.parse(recordHeldSince);
      if (Number.isNaN(heldSinceMs)) {
        throw new Error('Invalid leaderboard record-holder timestamp.');
      }
      if (rank !== 1 || heldSinceMs > Date.parse(achievedAt)) {
        throw new Error('Invalid leaderboard record-holder state.');
      }
    }

    players.add(raw.player_id);
    rows.push({
      rank,
      run_id: isUuid(raw.run_id) ? raw.run_id.toLowerCase() : null,
      player_id: raw.player_id,
      username: optionalText(raw.username),
      display_name: optionalText(raw.display_name),
      avatar_url: optionalText(raw.avatar_url),
      score,
      achieved_at: achievedAt,
      record_held_since: recordHeldSince,
    });
  }

  return rows;
}

export function parseLeaderboardReplay(payload) {
  const raw = Array.isArray(payload) ? payload[0] : payload;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Replay introuvable.');
  }

  const seed = Number(raw.seed);
  const terminalTick = Number(raw.terminal_tick);
  const score = Number(raw.score);
  const taps = Array.isArray(raw.taps) ? raw.taps.map(Number) : null;
  const resolvedAt = typeof raw.resolved_at === 'string' ? raw.resolved_at : '';

  if (!isUuid(raw.run_id) || !isUuid(raw.player_id)) throw new Error('Replay invalide.');
  if (!Number.isInteger(seed) || seed < -2147483648 || seed > 2147483647) throw new Error('Seed de replay invalide.');
  if (raw.physics_version !== 'flappy13-physics-v1') throw new Error('Version physique du replay non supportée.');
  if (!Number.isInteger(terminalTick) || terminalTick < 0 || terminalTick > 216000) throw new Error('Durée de replay invalide.');
  if (!taps || taps.length === 0 || taps[0] !== 0) throw new Error('Entrées de replay invalides.');

  let previous = -1;
  for (const tick of taps) {
    if (!Number.isInteger(tick) || tick <= previous || tick > terminalTick) {
      throw new Error('Entrées de replay invalides.');
    }
    previous = tick;
  }

  if (!Number.isInteger(score) || score < 0 || score > 2147483647) throw new Error('Score de replay invalide.');
  if (!['ground', 'upper-pipe', 'lower-pipe'].includes(raw.collision)) throw new Error('Collision de replay invalide.');
  if (!resolvedAt || Number.isNaN(Date.parse(resolvedAt))) throw new Error('Date de replay invalide.');

  const theme = optionalText(raw.theme);
  const variant = optionalText(raw.variant);
  if ((theme === null) !== (variant === null)) throw new Error('Contexte visuel du replay incomplet.');
  if (variant !== null && variant !== 'day' && variant !== 'night') throw new Error('Variante visuelle du replay invalide.');
  if (theme !== null && !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(theme)) throw new Error('Thème visuel du replay invalide.');

  return {
    run_id: raw.run_id.toLowerCase(),
    player_id: raw.player_id.toLowerCase(),
    seed,
    physics_version: raw.physics_version,
    terminal_tick: terminalTick,
    taps,
    score,
    collision: raw.collision,
    theme,
    variant,
    resolved_at: resolvedAt,
  };
}


export function parseLeaderboardContext(payload) {
  const raw = Array.isArray(payload) ? payload[0] : payload;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid personal leaderboard response.');
  }

  const playerId = raw.player_id;
  const verifiedRunsCount = Number(raw.verified_runs_count);
  const rank = raw.global_rank == null ? null : Number(raw.global_rank);
  const bestScore = raw.best_score == null ? null : Number(raw.best_score);
  const bestScoreAt = raw.best_score_at == null ? null : String(raw.best_score_at);

  if (!isUuid(playerId)) {
    throw new Error('Invalid personal leaderboard player.');
  }
  if (!Number.isInteger(verifiedRunsCount) || verifiedRunsCount < 0) {
    throw new Error('Invalid personal leaderboard run count.');
  }

  if (verifiedRunsCount === 0) {
    if (rank !== null || bestScore !== null || bestScoreAt !== null) {
      throw new Error('Invalid unranked personal leaderboard state.');
    }
  } else {
    if (!Number.isInteger(rank) || rank < 1) {
      throw new Error('Invalid personal leaderboard rank.');
    }
    if (!Number.isInteger(bestScore) || bestScore < 0 || bestScore > 2147483647) {
      throw new Error('Invalid personal leaderboard score.');
    }
    if (!bestScoreAt || Number.isNaN(Date.parse(bestScoreAt))) {
      throw new Error('Invalid personal leaderboard timestamp.');
    }
  }

  return {
    player_id: playerId,
    global_rank: rank,
    best_score: bestScore,
    verified_runs_count: verifiedRunsCount,
    best_score_at: bestScoreAt,
  };
}

export function parsePlayerPerformanceStats(payload) {
  const raw = Array.isArray(payload) ? payload[0] : payload;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid player performance response.');
  }

  const playerId = raw.player_id;
  const runCount = Number(raw.verified_runs_count);
  const totalScore = Number(raw.total_score);
  if (!isUuid(playerId)) throw new Error('Invalid player performance player.');
  if (!Number.isInteger(runCount) || runCount < 0) throw new Error('Invalid player performance run count.');
  if (!Number.isInteger(totalScore) || totalScore < 0) throw new Error('Invalid player performance total score.');

  const nullableNumber = (value, name, { integer = false, min = 0 } = {}) => {
    if (value == null) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || (integer && !Number.isInteger(number))) {
      throw new Error(`Invalid player performance ${name}.`);
    }
    return number;
  };

  const windows = {};
  for (const size of [10, 25, 50]) {
    const count = nullableNumber(raw[`recent_${size}_count`], `${size} count`, { integer: true });
    const average = nullableNumber(raw[`recent_${size}_average`], `${size} average`);
    const best = nullableNumber(raw[`recent_${size}_best`], `${size} best`, { integer: true });
    const median = nullableNumber(raw[`recent_${size}_median`], `${size} median`);
    const stddev = nullableNumber(raw[`recent_${size}_stddev`], `${size} stddev`);
    if (count === 0 && [average, best, median, stddev].some((value) => value !== null)) {
      throw new Error(`Invalid empty ${size}-run window.`);
    }
    windows[size] = { count, average, best, median, stddev };
  }

  const careerAverage = nullableNumber(raw.career_average, 'career average');
  const bestScore = nullableNumber(raw.best_score, 'best score', { integer: true });
  const trendPct = raw.recent_50_vs_career_pct == null
    ? null
    : nullableNumber(raw.recent_50_vs_career_pct, 'trend', { min: -Infinity });

  return {
    player_id: playerId,
    verified_runs_count: runCount,
    total_score: totalScore,
    career_average: careerAverage,
    best_score: bestScore,
    first_verified_run_at: raw.first_verified_run_at == null ? null : String(raw.first_verified_run_at),
    last_verified_run_at: raw.last_verified_run_at == null ? null : String(raw.last_verified_run_at),
    recent_10: windows[10],
    recent_25: windows[25],
    recent_50: windows[50],
    recent_50_vs_career_pct: trendPct,
  };
}

export function leaderboardName(row) {
  return row?.display_name || row?.username || 'Joueur';
}
