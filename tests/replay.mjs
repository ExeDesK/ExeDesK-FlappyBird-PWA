import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Game } from '../site/src/game.js';
export function runReplay(data) {
  if (data.schema !== 'flappy13-replay-v1' ||
    !Number.isInteger(data.totalFrames) ||
    data.totalFrames < 0 ||
    data.totalFrames > 1000000) {
    throw new Error('Replay invalide ou trop long');
  }
  if (data.truncated) {
    throw new Error('Replay tronqué : vérification complète impossible');
  }
  const inputs = new Map(data.inputs.map(entry => [entry.frame, entry]));
  const game = new Game({ seed: data.seed, best: data.bestAtBoot });
  let touches = [];
  for (let frame = 1; frame <= data.totalFrames; frame++) {
    const entry = inputs.get(frame);
    if (entry) {
      touches = entry.touches ?? [];
    }
    game.tick({
      touches,
      ...(entry?.tap ? { tap: entry.tap } : {}),
    });
  }
  return game.snapshot();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('Usage: node tests/replay.mjs replay.json');
    process.exit(2);
  }
  try {
    const data = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const final = runReplay(data);
    const matches = isDeepStrictEqual(final, data.final);
    console.log(JSON.stringify(final, null, 2));
    console.log(matches ? 'REPLAY CONFORME' : 'DIFFÉRENCE AVEC LA TRACE');
    if (!matches) {
      process.exitCode = 1;
    }
  }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
