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


test('Home navigation is exposed on READY and GAME OVER but not during gameplay', () => {
  const source = read('site/src/main.js');
  assert.match(source, /state === 'READY' \|\| state === 'GAME_OVER'/);
  assert.match(source, /\['READY', 'GAME_OVER'\]\.includes\(state\)/);
});

test('Settings expose parity statement and GitHub link', () => {
  const html = read('site/index.html');
  assert.match(html, /COMPORTEMENT 1:1/);
  assert.match(html, /dernière version originale[\s\S]*Flappy Bird 1\.3/);
  assert.match(html, /https:\/\/github\.com\/ExeDesK\/FlappyBird-PWA/);
});

test('authenticated PLAY requests a verified ticket and offers an explicit unranked fallback', () => {
  const main = read('site/src/main.js');
  const html = read('site/index.html');

  assert.match(main, /auth\.startVerifiedRun\(\)/);
  assert.match(main, /createCanonicalRunGame/);
  assert.match(main, /new VerifiedRunRecorder\(ticket\)/);
  assert.match(main, /enqueueVerifiedRun\(submission, \{ playerId \}\)/);
  assert.match(main, /hasSession: Boolean\(auth\.session\)/);
  assert.match(html, /id="unranked-warning"/);
  assert.match(html, /id="unranked-continue"/);
  assert.match(html, /JOUER QUAND MÊME/);
});

test('completed verified runs flush automatically without trusting a client score', () => {
  const main = read('site/src/main.js');
  const auth = read('site/src/auth.js');
  const verifiedClient = read('site/src/verified-run-client.js');
  const submitMethod = auth.slice(
    auth.indexOf('async submitVerifiedRun(submission)'),
    auth.indexOf('\n  async sync(', auth.indexOf('async submitVerifiedRun(submission)')),
  );

  assert.match(main, /auth\.submitVerifiedRun\(submission\)/);
  assert.match(main, /removePendingVerifiedRun\(submission\.run_id\)/);
  assert.match(main, /flushVerifiedRunQueue\(\{ reason: 'online', notify: true \}\)/);
  assert.match(main, /type === 'record' && !verifiedRunRecorder/);
  assert.match(main, /highestVerifiedScore >= 0[\s\S]*saveBest\(highestVerifiedScore\)/);
  assert.match(main, /shouldDiscardVerifiedRunSubmission\(error\)/);
  assert.match(main, /shouldDiscardVerifiedRunSubmission\(error\)[\s\S]*continue;/);
  assert.match(verifiedClient, /error\?\.code === 'run_not_found'/);
  assert.match(auth, /functions\/v1\/run-submit/);
  assert.match(submitMethod, /createVerifiedRunSubmission\(submission\)/);
  assert.match(submitMethod, /body: JSON\.stringify\(normalized\)/);
  assert.doesNotMatch(submitMethod, /JSON\.stringify\([^)]*(seed|score)/);
});

test('Discord community auth uses deploy-time runtime config and ships no server secret', () => {
  const auth = read('site/src/auth.js');
  const main = read('site/src/main.js');
  const html = read('site/index.html');
  const workflow = read('.github/workflows/pages.yml');
  const gitignore = read('.gitignore');
  const example = read('site/config.example.js');
  const sql = read('supabase/001_profiles.sql');

  assert.match(main, /globalThis\.FLAPPY_CONFIG/);
  assert.doesNotMatch(main, /sb_publishable_[A-Za-z0-9_-]{16,}/);
  assert.doesNotMatch(main, /sb_secret_/);
  assert.doesNotMatch(main, /service_role/i);
  assert.match(html, /<script src="\.\/config\.js"><\/script>/);
  assert.match(workflow, /secrets\.SUPABASE_URL/);
  assert.match(workflow, /secrets\.SUPABASE_PUBLISHABLE_KEY/);
  assert.match(workflow, /site\/config\.js/);
  assert.match(gitignore, /site\/config\.js/);
  assert.match(example, /YOUR_PROJECT_REF/);
  assert.match(example, /sb_publishable_YOUR_PUBLIC_KEY/);
  assert.match(auth, /provider', 'discord'/);
  assert.match(auth, /auth\/v1\/user/);
  assert.match(auth, /grant_type=refresh_token/);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /auth\.uid\(\) = id/);
  assert.match(sql, /grant select on public\.profiles to anon, authenticated/i);
});

test('repository does not contain a production Supabase runtime configuration', () => {
  const publishableKey = /sb_publishable_(?!YOUR_PUBLIC_KEY)[A-Za-z0-9_-]{16,}/;
  const concreteProjectUrl = /https:\/\/[a-z0-9]{20}\.supabase\.co/;
  const textFiles = walk('.').filter((file) => !/\.(png|jpg|jpeg|gif|webp|ogg|wav|zip)$/i.test(file));

  for (const file of textFiles) {
    const content = read(file);
    assert.equal(publishableKey.test(content), false, `${file} contains a concrete Supabase publishable key`);
    publishableKey.lastIndex = 0;
    assert.equal(concreteProjectUrl.test(content), false, `${file} contains a concrete Supabase project URL`);
    concreteProjectUrl.lastIndex = 0;
  }
});
