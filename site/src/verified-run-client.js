export function verifiedRunStartMode({ hasSession = false, online = true } = {}) {
  if (!hasSession) {
    return 'local';
  }

  return online ? 'ticket' : 'warn-offline';
}

export function isPlayRelease(game, input = {}) {
  if (!game?.play?.active || !game.play.pressed) {
    return false;
  }

  const touches = Array.isArray(input.touches) ? input.touches : [];
  return !touches.some(point =>
    point.x > game.play.x &&
    point.x < game.play.x + game.play.w &&
    point.y > game.play.y &&
    point.y < game.play.y + game.play.h
  );
}
