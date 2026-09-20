import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const read = (path) => readFileSync(path, 'utf8');

function walk(dir, root = dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, root, out);
    else out.push(relative(root, full).replaceAll('\\', '/'));
  }
  return out;
}

test('APK parity runs on every push and pull request against a pinned harness release', () => {
  const workflow = read('.github/workflows/apk-parity.yml');
  assert.match(workflow, /\n\s*push:\s*\n/);
  assert.match(workflow, /\n\s*pull_request:\s*\n/);
  assert.match(workflow, /HARNESS_REPOSITORY:\s*ExeDesK\/Flappy13-APK-TestHarness/);
  assert.match(workflow, /HARNESS_REF:\s*v3\.2\.2/);
  assert.match(workflow, /compare-suite\.sh/);
});

test('GitHub Pages deployment is gated by APK parity', () => {
  const workflow = read('.github/workflows/pages.yml');
  const compare = workflow.indexOf('compare-suite.sh');
  const deploy = workflow.indexOf('actions/deploy-pages@');
  assert.ok(compare >= 0, 'parity comparison step missing');
  assert.ok(deploy >= 0, 'Pages deployment step missing');
  assert.ok(compare < deploy, 'parity must run before deployment');
  assert.match(workflow, /HARNESS_REF:\s*v3\.2\.2/);
});

test('PWA repository contains no APK payload', () => {
  const forbidden = walk('.').filter((file) => /\.(apk|aab|apks)$/i.test(file));
  assert.deepEqual(forbidden, []);
});
