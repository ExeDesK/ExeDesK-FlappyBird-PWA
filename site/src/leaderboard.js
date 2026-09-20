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

    players.add(raw.player_id);
    rows.push({
      rank,
      player_id: raw.player_id,
      username: optionalText(raw.username),
      display_name: optionalText(raw.display_name),
      avatar_url: optionalText(raw.avatar_url),
      score,
      achieved_at: achievedAt,
    });
  }

  return rows;
}

export function leaderboardName(row) {
  return row?.display_name || row?.username || 'Joueur';
}
