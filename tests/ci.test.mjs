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

test('iOS ProMotion guidance is dynamic and links to the timestamped tutorial', () => {
  const html = read('site/index.html');
  const main = read('site/src/main.js');

  assert.match(html, /id="ios-promotion-hint"[\s\S]*hidden/);
  assert.match(html, /youtube\.com\/watch\?v=0ZesazGpAVM&amp;t=37s/);
  assert.match(html, /Enable That Hidden 120 hz Mode On Your iPhone/);
  assert.match(main, /isAppleTouchDevice/);
  assert.match(main, /measureNativeRafHz/);
  assert.match(main, /hz >= 90/);
  assert.match(main, /Haute fréquence active/);
});

test('authenticated PLAY requests a verified ticket and offers an explicit unranked fallback', () => {
  const main = read('site/src/main.js');
  const verifiedPlay = read('site/src/session/verified-play.js');
  const queue = read('site/src/session/verified-run-queue.js');
  const warning = read('site/src/ui/unranked-warning.js');
  const html = read('site/index.html');

  assert.match(verifiedPlay, /this\.api\.start\(\)/);
  assert.match(main, /createCanonicalRunGame/);
  assert.match(verifiedPlay, /new VerifiedRunRecorder\(ticket,\s*\{[\s\S]*visualContext:/);
  assert.match(verifiedPlay, /this\.queue\.enqueue\(submission, \{ playerId \}\)/);
  assert.match(queue, /class VerifiedRunQueue/);
  assert.match(verifiedPlay, /hasSession: Boolean\(this\.auth\.session\)/);
  assert.match(verifiedPlay, /this\.warning\.ask\(/);
  assert.match(warning, /class UnrankedWarningDialog/);
  assert.match(html, /id="unranked-warning"/);
  assert.match(html, /id="unranked-continue"/);
  assert.match(html, /JOUER QUAND MÊME/);
});

test('completed verified runs flush automatically without trusting a client score', () => {
  const main = read('site/src/main.js');
  const verifiedPlay = read('site/src/session/verified-play.js');
  const verifiedSubmit = read('site/src/session/verified-run-submit.js');
  const verifiedApi = read('site/src/api/verified-run-api.js');
  const submitMethod = verifiedApi.slice(
    verifiedApi.indexOf('async submit(submission)'),
    verifiedApi.indexOf('async #requiredAccessToken', verifiedApi.indexOf('async submit(submission)')),
  );

  assert.match(verifiedPlay, /this\.submitter[\s\S]*\.flushForPlayer\(playerId, \{ reason \}\)/);
  assert.match(verifiedSubmit, /this\.api\.submit\(submission\)/);
  assert.match(verifiedSubmit, /this\.queue\.remove\(submission\.run_id\)/);
  assert.match(main, /verifiedPlay\.flush\(\{ reason: 'online', notify: true \}\)/);
  assert.match(main, /type === 'record' && !verifiedPlay\.recording/);
  assert.match(verifiedPlay, /result\.highestVerifiedScore >= 0[\s\S]*this\.saveBest\?\.\(result\.highestVerifiedScore\)/);
  assert.match(verifiedSubmit, /shouldDiscardVerifiedRunSubmission\(error\)/);
  assert.match(verifiedSubmit, /shouldDiscardVerifiedRunSubmission\(error\)[\s\S]*continue;/);
  assert.match(verifiedSubmit, /error\?\.code === 'run_not_found'/);
  assert.match(verifiedApi, /functions\/v1\/run-submit/);
  assert.match(submitMethod, /createVerifiedRunSubmission\(submission\)/);
  assert.match(submitMethod, /body: JSON\.stringify\(normalized\)/);
  assert.doesNotMatch(submitMethod, /JSON\.stringify\([^)]*(seed|score)/);
});

test('OAuth community auth uses deploy-time runtime config and ships no server secret', () => {
  const auth = read('site/src/auth.js');
  const identityLinking = read('site/src/auth/identity-linking.js');
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
  assert.match(auth, /signInWithProvider\('discord'\)/);
  assert.match(main, /signInWithProvider\('google'\)/);
  assert.match(auth, /auth\/v1\/user/);
  assert.match(identityLinking, /auth\/v1\/user\/identities\/authorize/);
  assert.match(identityLinking, /skip_http_redirect/);
  assert.doesNotMatch(identityLinking, /service_role/i);
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

test('error toasts use the top layer and routine success chatter stays silent', () => {
  const html = read('site/index.html');
  const main = read('site/src/main.js');
  const verifiedPlay = read('site/src/session/verified-play.js');
  const toastUi = read('site/src/ui/toast.js');
  const appSources = `${main}\n${verifiedPlay}`;

  assert.match(html, /id="toast"[^>]*popover="manual"/);
  assert.match(toastUi, /node\.showPopover\(\)/);
  assert.match(verifiedPlay, /Pas d’internet · envoi reporté/);
  assert.doesNotMatch(appSources, /Tout est prêt · vous pouvez jouer même hors connexion/);
  assert.doesNotMatch(appSources, /Partie classée prête · touchez pour commencer/);
  assert.doesNotMatch(appSources, /Run terminé · vérification serveur/);
  assert.doesNotMatch(appSources, /Run vérifié · score/);
  assert.doesNotMatch(appSources, /Préparation de la partie classée/);
});

test('verified PLAY hides ticket latency behind the native one-second fade cadence', () => {
  const main = read('site/src/main.js');
  const verifiedPlay = read('site/src/session/verified-play.js');
  const transition = read('site/src/ui/game-transition.js');

  assert.match(main, /PLAY_FADE_SECONDS = 0\.5/);
  assert.match(main, /playFadeSeconds: PLAY_FADE_SECONDS/);
  assert.match(transition, /this\.minDurationMs = durationSeconds \* 1000/);
  assert.match(transition, /originGame\.transition\(true, 0, this\.durationSeconds\)/);
  assert.match(verifiedPlay, /mode === 'ticket'[\s\S]*this\.transition\.startToBlack\(game\)/);
  assert.match(verifiedPlay, /this\.transition\.ensureBlack\(originGame, fadeStartedAt\)/);
  assert.match(verifiedPlay, /Promise\.all\(\[ticketPromise, fadePromise\]\)/);
  assert.match(transition, /this\.now\(\) - startedAt < this\.minDurationMs/);
  assert.match(main, /game\.transition\(false, 0, PLAY_FADE_SECONDS\)/);
});


test('verified game swap paints a fully black cached frame before reveal fade', () => {
  const main = read('site/src/main.js');
  const black = main.indexOf('game.fade.value = 1;');
  const cachedBlack = main.indexOf('const blackCommands = cloneCommands(game.commands);', black);
  const opaqueOverlay = main.indexOf("name: 'black'", cachedBlack);
  const previousCache = main.indexOf('previousCommands = cloneCommands(blackCommands);', opaqueOverlay);
  const currentCache = main.indexOf('currentCommands = cloneCommands(blackCommands);', previousCache);
  const renderBlack = main.indexOf('render(1);', currentCache);
  const reveal = main.indexOf('game.transition(false, 0, PLAY_FADE_SECONDS);', renderBlack);

  assert.ok(black >= 0, 'replacement game should be pinned to full black');
  assert.ok(cachedBlack > black, 'black renderer command cache should be rebuilt after pinning fade');
  assert.ok(opaqueOverlay > cachedBlack, 'black cache should include an explicit opaque black overlay');
  assert.ok(previousCache > opaqueOverlay, 'previous interpolation cache should be black');
  assert.ok(currentCache > previousCache, 'current interpolation cache should be black');
  assert.ok(renderBlack > currentCache, 'black cached scene should be rendered before reveal');
  assert.ok(reveal > renderBlack, 'reveal fade should start only after black frame is painted');
});

test('application domains stay split across focused ES modules', () => {
  const main = read('site/src/main.js');
  const auth = read('site/src/auth.js');
  const identityLinking = read('site/src/auth/identity-linking.js');
  const leaderboardApi = read('site/src/api/leaderboard-client.js');
  const verifiedApi = read('site/src/api/verified-run-api.js');
  const bestScoreApi = read('site/src/api/best-score-client.js');
  const verifiedPlay = read('site/src/session/verified-play.js');
  const verifiedQueue = read('site/src/session/verified-run-queue.js');
  const verifiedSubmit = read('site/src/session/verified-run-submit.js');
  const recorder = read('site/src/replay/verified-run-recorder.js');
  const transition = read('site/src/ui/game-transition.js');
  const unrankedWarning = read('site/src/ui/unranked-warning.js');

  assert.ok(main.split('\n').length <= 1650, 'main.js should stay an orchestration layer, not a monolith');
  assert.ok(auth.split('\n').length <= 450, 'auth.js should stay focused on auth/session/profile');
  assert.ok(identityLinking.split('\n').length <= 320, 'identity-linking.js should stay focused on provider identity management');
  assert.ok(verifiedPlay.trimEnd().split('\n').length <= 300, 'verified-play.js should stay focused on orchestration');

  assert.match(main, /import \{ LeaderboardUI \} from '\.\/ui\/leaderboard-ui\.js'/);
  assert.match(main, /import \{ ToastController \} from '\.\/ui\/toast\.js'/);
  assert.match(main, /import \{ VerifiedPlayController \} from '\.\/session\/verified-play\.js'/);
  assert.match(main, /import \{ PwaUpdateManager \} from '\.\/pwa\/update-manager\.js'/);
  assert.match(main, /import \{ ReplayViewer \} from '\.\/replay\/replay-viewer\.js'/);
  assert.match(main, /import \{ LeaderboardClient \} from '\.\/api\/leaderboard-client\.js'/);
  assert.match(main, /import \{ VerifiedRunClient \} from '\.\/api\/verified-run-api\.js'/);
  assert.match(auth, /IdentityLinkingController/);

  assert.doesNotMatch(auth, /get_leaderboard/);
  assert.doesNotMatch(auth, /functions\/v1\/run-(?:start|submit)/);
  assert.doesNotMatch(auth, /sync_best_score/);
  assert.match(leaderboardApi, /get_leaderboard/);
  assert.match(verifiedApi, /functions\/v1\/run-start/);
  assert.match(verifiedApi, /functions\/v1\/run-submit/);
  assert.match(bestScoreApi, /sync_best_score/);
  assert.match(verifiedPlay, /import \{ VerifiedRunRecorder \} from '\.\.\/replay\/verified-run-recorder\.js'/);
  assert.match(verifiedPlay, /import \{ VerifiedRunQueue \} from '\.\/verified-run-queue\.js'/);
  assert.match(verifiedPlay, /import \{ VerifiedRunSubmitter \} from '\.\/verified-run-submit\.js'/);
  assert.match(verifiedPlay, /import \{ GameTransitionController \} from '\.\.\/ui\/game-transition\.js'/);
  assert.match(verifiedPlay, /import \{ UnrankedWarningDialog \} from '\.\.\/ui\/unranked-warning\.js'/);
  assert.match(verifiedQueue, /class VerifiedRunQueue/);
  assert.match(verifiedSubmit, /class VerifiedRunSubmitter/);
  assert.match(recorder, /class VerifiedRunRecorder/);
  assert.match(transition, /class GameTransitionController/);
  assert.match(unrankedWarning, /class UnrankedWarningDialog/);
});

test('diagnostic theme selector is catalog-driven, dark-native and split into collapsible sections', () => {
  const html = read('site/index.html');
  const main = read('site/src/main.js');
  const css = read('site/style.css');

  assert.match(html, /<select id="debug-theme"[^>]*><\/select>/);
  assert.match(main, /for \(const \[id, definition\] of themeEntries\(themeCatalog\)\)/);
  assert.match(main, /select\.replaceChildren\(\)/);
  assert.match(html, /id="debug-close"/);
  assert.equal((html.match(/<details class="debug-section"/g) ?? []).length, 6);
  assert.match(main, /\$\('debug-close'\)\.onclick = \(\) => \{\s*setDebug\(false\);/);
  assert.match(css, /#diagnostic \{[\s\S]*color-scheme: dark;/);
  assert.doesNotMatch(css, /\.debug-theme-controls select\s*\{/);
});

test('profile UI exposes explicit unlink confirmation while protecting the last login provider', () => {
  const account = readFileSync(new URL('../site/src/ui/account.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  assert.match(account, /DÉLIER/);
  assert.match(account, /CONFIRMER/);
  assert.match(account, /ANNULER/);
  assert.match(account, /DERNIER ACCÈS/);
  assert.match(account, /linkedCount > 1/);
  assert.match(html, /identity-management-status/);
  const main = readFileSync(new URL('../site/src/main.js', import.meta.url), 'utf8');
  assert.match(main, /auth\.sync\(\{ reason: 'profile-open' \}\)/);
});
