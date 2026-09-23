"""Optional isolated Chromium smoke test.

This test embeds the static site and its assets directly in a Chromium page. It
checks the main UI/game paths, but it does NOT validate HTTP navigation, a real
Service Worker installation or GitHub Pages itself.

Usage:
    python tests/browser_isolated.py [--chromium /path/to/chromium]
"""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import re
import shutil

from playwright.sync_api import sync_playwright


MODULE_ORDER = [
    'math.js',
    'clock.js',
    'perf.js',
    'game.js',
    'verified-runs.js',
    'verified-run-client.js',
    'replay/verified-run-recorder.js',
    'themes.js',
    'atlas.js',
    'audio.js',
    'leaderboard.js',
    'api/http.js',
    'auth.js',
    'api/best-score-client.js',
    'api/leaderboard-client.js',
    'api/verified-run-api.js',
    'display.js',
    'pwa/update-manager.js',
    'session/score-sync.js',
    'session/verified-run-queue.js',
    'session/verified-run-submit.js',
    'ui/game-transition.js',
    'ui/unranked-warning.js',
    'session/verified-play.js',
    'ui/account.js',
    'ui/leaderboard-ui.js',
    'ui/toast.js',
    'main.js',
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--chromium',
        default=shutil.which('chromium') or shutil.which('chromium-browser'),
    )
    parser.add_argument('--output', default='test-output/isolated-browser')
    return parser.parse_args()


def build_embedded_page(site_root: Path) -> tuple[str, str]:
    html = (site_root / 'index.html').read_text(encoding='utf-8')
    css = (site_root / 'style.css').read_text(encoding='utf-8')

    html = re.sub(r'<link[^>]+>', '', html)
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S)
    html = html.replace('</head>', f'<style>{css}</style></head>')

    assets = {
        '/' + str(file.relative_to(site_root)).replace('\\', '/'):
            base64.b64encode(file.read_bytes()).decode()
        for file in site_root.rglob('*')
        if file.is_file()
    }

    modules = []

    for name in MODULE_ORDER:
        module_path = site_root / 'src' / name
        script = module_path.read_text(encoding='utf-8')
        script = re.sub(r'^import[\s\S]*?;\n', '', script, flags=re.M)
        script = script.replace('export ', '')

        module_url = json.dumps(f'http://test.invalid/src/{name}')
        script = script.replace('import.meta.url', module_url)

        if name == 'main.js':
            # page.set_content() uses about:blank. Give URL-based update/scope
            # calculations a stable synthetic origin inside this harness.
            script = script.replace("location.href", "'http://test.invalid/'")

        if name == 'atlas.js':
            # The browser harness concatenates ES modules into one script.
            # Keep module-local logical-size constants distinct from display.js.
            script = script.replace('LOGICAL_WIDTH', 'ATLAS_LOGICAL_WIDTH')
            script = script.replace('LOGICAL_HEIGHT', 'ATLAS_LOGICAL_HEIGHT')

            # Images are normally loaded through static URLs. In this isolated
            # set_content() harness, route both atlas images to embedded data
            # URIs so Image() can load them without a real HTTP origin.
            script = re.sub(
                r"const atlasImageUrl = new URL\(\s*['\"]\.\./assets/atlas\.png['\"]\s*,\s*"
                + re.escape(module_url)
                + r"\s*\);",
                "const atlasImageUrl = 'data:image/png;base64,' + __assets['/assets/atlas.png'];",
                script,
            )
            script = re.sub(
                r"const customImageUrl = new URL\(\s*['\"]\.\./assets/customatlas\.png['\"]\s*,\s*"
                + re.escape(module_url)
                + r"\s*\);",
                "const customImageUrl = 'data:image/png;base64,' + __assets['/assets/customatlas.png'];",
                script,
            )

        modules.append(script)

    harness = r"""
(function () {
  const __assets = ASSETS;

  window.fetch = async input => {
    const url = new URL(String(input), 'http://test.invalid/');

    // Keep the static update probe offline in this isolated harness. A real
    // host reachability check is covered separately by unit tests/deployment.
    if (url.pathname.endsWith('/version.json')) {
      throw new TypeError('Simulated offline host');
    }

    const bytes = __assets[url.pathname];
    if (!bytes) {
      return new Response('Not found', { status: 404 });
    }

    return new Response(Uint8Array.from(atob(bytes), char => char.charCodeAt(0)));
  };

CONTENT
})();
"""

    script = harness.replace('ASSETS', json.dumps(assets)).replace(
        'CONTENT',
        '\n'.join(modules),
    )
    return html, script


def main() -> None:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[1]
    site_root = project_root / 'site'
    theme_catalog = json.loads((site_root / 'assets' / 'themes.json').read_text(encoding='utf-8'))
    expected_theme_options = ['auto', *theme_catalog['themes'].keys()]
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    html, script = build_embedded_page(site_root)

    with sync_playwright() as playwright:
        launch_options = {'headless': True}
        if args.chromium:
            launch_options['executable_path'] = args.chromium

        browser = playwright.chromium.launch(**launch_options)

        context = browser.new_context(
            viewport={'width': 960, 'height': 820},
            device_scale_factor=1,
        )
        page = context.new_page()
        errors: list[str] = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        page.set_content(html)
        page.evaluate(script)
        page.wait_for_function('window.flappy', timeout=15000)

        assert page.input_value('#aspect') == 'original'
        assert not page.is_checked('#performance-mode')
        assert page.evaluate('[game.width, game.height]') == [576, 1024]
        assert page.is_disabled('#refresh-cache')
        assert page.eval_on_selector_all(
            '#debug-theme option',
            'options => options.map(option => option.value)',
        ) == expected_theme_options
        assert page.evaluate(
            "getComputedStyle(document.querySelector('#open-options')).width"
        ) == '60px'
        assert page.evaluate(
            "document.querySelector('#utility-atlas-icon').style.width"
        ) == '45.5px'
        assert page.evaluate(
            "document.querySelector('#utility-atlas-icon').style.height"
        ) == '49px'
        assert page.evaluate(
            "document.querySelector('#profile-atlas-icon').style.width"
        ) == '45.5px'
        assert page.evaluate(
            "document.querySelector('#profile-atlas-icon').style.height"
        ) == '49px'
        assert page.evaluate(
            "document.querySelector('#close-options-icon').style.width"
        ) == '26px'
        assert page.evaluate(
            "document.querySelector('#close-options-icon').style.height"
        ) == '28px'

        page.evaluate('flappy.pause(); for (let i = 0; i < 60; i++) flappy.step();')
        assert page.evaluate('flappy.snapshot().state') == 'MENU'
        assert not page.is_hidden('#open-options')
        assert not page.is_hidden('#open-profile')
        menu_box = page.locator('#open-options').bounding_box()
        profile_box = page.locator('#open-profile').bounding_box()
        assert menu_box is not None and profile_box is not None
        assert profile_box['x'] + profile_box['width'] <= menu_box['x']
        page.screenshot(path=str(output / 'menu.png'))

        # Profile remains a dedicated modal with no provider buttons or identity-linking
        # actions. It now hosts only the sign-out action at the bottom when a
        # session is active, and still closes with the atlas sprite.
        page.click('#open-profile')
        page.wait_for_selector('#profile-dialog', state='visible')
        assert page.locator('#profile-dialog #discord-login').count() == 0
        assert page.locator('#profile-dialog #discord-logout').count() == 1
        assert page.locator('#profile-dialog [id*=link]').count() == 0
        assert not page.is_hidden('#account-signed-out')
        assert page.is_hidden('#account-signed-in')
        assert page.evaluate(
            "document.querySelector('#close-profile-icon').style.width"
        ) == '26px'
        assert page.evaluate(
            "document.querySelector('#close-profile-icon').style.height"
        ) == '28px'
        page.screenshot(path=str(output / 'profile.png'))
        page.click('#close-profile')
        page.wait_for_selector('#profile-dialog', state='hidden')

        page.evaluate(
            'flappy.step({ touches: [{ x: 78, y: 375 }] });'
            'flappy.step();'
            'for (let i = 0; i < 65; i++) flappy.step();'
        )
        assert page.evaluate('flappy.snapshot().state') == 'READY'
        assert not page.is_hidden('#open-options')
        assert page.is_hidden('#open-profile')
        assert page.get_attribute('#open-options', 'data-mode') == 'home'
        page.screenshot(path=str(output / 'ready.png'))

        # READY exposes a Home control, not Settings. It returns to the title
        # screen so future lobby/multiplayer flows have a clean escape route.
        page.evaluate('flappy.pause(false)')
        page.click('#open-options')
        page.wait_for_function("flappy.snapshot().state === 'MENU' && flappy.snapshot().fade === 0", timeout=10000)
        assert page.get_attribute('#open-options', 'data-mode') == 'options'

        # Start a fresh run after validating READY -> Home.
        page.evaluate('flappy.pause(true)')
        page.evaluate(
            'flappy.step({ touches: [{ x: 78, y: 375 }] });'
            'flappy.step();'
            'for (let i = 0; i < 65; i++) flappy.step();'
            'flappy.step({ touches: [], tap: { x: 144, y: 256 } });'
            'for (let i = 0; i < 4; i++) flappy.step();'
        )
        assert page.evaluate('flappy.snapshot().state') == 'PLAYING'
        assert page.is_hidden('#open-options')
        page.screenshot(path=str(output / 'playing.png'))

        page.evaluate('for (let i = 0; i < 236; i++) flappy.step();')
        assert page.evaluate('flappy.snapshot().state') == 'GAME_OVER'
        assert not page.is_hidden('#open-options')
        assert page.is_hidden('#open-profile')
        assert page.get_attribute('#open-options', 'data-mode') == 'home'
        page.screenshot(path=str(output / 'gameover.png'))

        # GAME OVER exposes the same Home control as READY.
        page.evaluate('flappy.pause(false)')
        page.click('#open-options')
        page.wait_for_function("flappy.snapshot().state === 'MENU' && flappy.snapshot().fade === 0", timeout=10000)
        assert page.get_attribute('#open-options', 'data-mode') == 'options'

        page.click('#open-options')
        page.wait_for_selector('#options', state='visible')
        assert page.locator('#debug').count() == 0
        assert page.locator('#debug-access').count() == 1
        assert page.locator('a.footer-link').get_attribute('href') == 'https://github.com/ExeDesK/FlappyBird-PWA'
        assert page.locator('#discord-login').count() == 1
        assert page.locator('#discord-logout').count() == 1
        assert page.locator('#options #account-signed-out').count() == 0
        assert page.locator('#options #account-signed-in').count() == 0
        assert page.locator('#options #profile-best-score').count() == 0
        assert page.evaluate(
            "document.querySelector('#close-options-icon').style.width"
        ) == '26px'
        assert 'Flappy Bird 1.3' in page.locator('.parity-note').inner_text()
        page.screenshot(path=str(output / 'options.png'))

        # Diagnostic tools are grouped into collapsible sections. Theme options
        # are generated from themes.json and the panel can close itself.
        page.click('#debug-access')
        page.wait_for_selector('#diagnostic', state='visible')
        assert page.locator('#diagnostic details.debug-section').count() == 6
        assert page.eval_on_selector_all(
            '#debug-theme option',
            'options => options.map(option => option.value)',
        ) == expected_theme_options
        assert page.evaluate(
            "getComputedStyle(document.querySelector('#diagnostic')).colorScheme"
        ) == 'dark'
        page.select_option('#debug-theme', 'vietnam')
        assert not page.is_hidden('#debug-variant-row')
        assert page.evaluate("flappy.theme().active.theme") == 'vietnam'
        page.select_option('#debug-theme-variant', 'night')
        assert page.evaluate("flappy.theme().active.variant") == 'night'
        page.screenshot(path=str(output / 'diagnostic-vietnam.png'))
        page.select_option('#debug-theme', 'auto')
        page.screenshot(path=str(output / 'diagnostic.png'))
        page.click('#debug-close')
        page.wait_for_selector('#diagnostic', state='hidden')

        page.evaluate('flappy.pause(false)')
        page.keyboard.down('Space')
        page.wait_for_timeout(100)
        page.keyboard.up('Space')
        page.wait_for_function(
            "flappy.snapshot().state === 'READY' && flappy.snapshot().ready.stage === 1",
            timeout=10000,
        )
        assert page.evaluate('flappy.snapshot().state') == 'READY'

        page.keyboard.press('Space')
        page.wait_for_timeout(100)
        assert page.evaluate('flappy.snapshot().state') == 'PLAYING'

        page.wait_for_function('flappy.audio.buffers.size === 5', timeout=10000)
        audio = page.evaluate(
            '({ '
            'state: flappy.audio.context?.state, '
            'buffers: flappy.audio.buffers.size, '
            'error: flappy.audio.error '
            '})'
        )
        assert audio['state'] == 'running'
        assert audio['buffers'] == 5
        assert not audio['error']

        page.set_viewport_size({'width': 390, 'height': 844})
        page.evaluate(
            "document.querySelector('#aspect').value = 'adapted';"
            "document.querySelector('#aspect').dispatchEvent("
            "new Event('change', { bubbles: true })"
            ");"
        )
        page.wait_for_timeout(50)

        layout = page.evaluate('flappy.layout()')
        assert layout['topGap'] > 0
        assert layout['bottomGap'] > 0

        rect = page.locator('#game').bounding_box()
        assert abs(rect['height'] - 844) < 1
        page.screenshot(path=str(output / 'mobile.png'))
        assert not errors, errors
        context.close()

        mobile = browser.new_context(
            viewport={'width': 844, 'height': 390},
            screen={'width': 844, 'height': 390},
            device_scale_factor=2,
            has_touch=True,
            is_mobile=True,
        )
        mobile_page = mobile.new_page()
        mobile_errors: list[str] = []
        mobile_page.on('pageerror', lambda error: mobile_errors.append(str(error)))

        mobile_page.set_content(html)
        mobile_page.evaluate(script)
        mobile_page.wait_for_function('window.flappy', timeout=15000)
        assert mobile_page.locator('#orientation-lock').is_visible()
        assert not mobile_errors, mobile_errors
        mobile.close()

        report = {
            'environment': 'Isolated Chromium DOM with embedded original assets; no network navigation',
            'errors': errors,
            'audio': audio,
            'keyboardRestart': 'READY',
            'keyboardFlap': 'PLAYING',
            'landscapeGuard': 'VISIBLE',
            'offlineBrowser': 'NOT_TESTED',
            'httpModuleLoading': 'NOT_TESTED',
            'localStoragePersistence': 'NOT_TESTED',
            'nativeAPKComparison': 'NOT_TESTED',
        }
        (output / 'report.json').write_text(
            json.dumps(report, indent=2),
            encoding='utf-8',
        )
        print(json.dumps(report, indent=2))

        browser.close()


if __name__ == '__main__':
    main()
