import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'supabase/functions/_shared/physics-v1');
const files = ['math.js', 'game.js', 'verified-runs.js'];
const checkOnly = process.argv.includes('--check');
const mismatches = [];

await mkdir(destination, { recursive: true });

for (const name of files) {
  const sourcePath = join(root, 'site/src', name);
  const destinationPath = join(destination, name);
  const source = await readFile(sourcePath, 'utf8');

  if (checkOnly) {
    const current = await readFile(destinationPath, 'utf8').catch(() => null);
    if (current !== source) {
      mismatches.push(name);
    }
  } else {
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, source);
  }
}

if (mismatches.length) {
  console.error(
    `Moteur Edge désynchronisé : ${mismatches.join(', ')}. `
    + 'Exécutez npm run sync:edge-physics.',
  );
  process.exitCode = 1;
} else if (checkOnly) {
  console.log('Moteur Edge flappy13-physics-v1 synchronisé.');
}
