"""Optional isolated Chromium smoke test for the private Admin Analytics dashboard.

The static admin HTML/CSS and ES modules are embedded into one Chromium page,
with Supabase Auth/RPC responses mocked in-memory. This validates browser-side
composition without requiring a network origin or a real Supabase project.

Usage:
    python tests/admin_browser_isolated.py [--chromium /path/to/chromium]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil

from playwright.sync_api import sync_playwright


MODULE_ORDER = [
    'api/http.js',
    'auth.js',
    'admin/analytics-client.js',
    'admin/charts.js',
    'admin/dashboard.js',
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('chromium-browser'))
    parser.add_argument('--output', default='test-output/admin-browser')
    return parser.parse_args()


def build_page(site: Path) -> tuple[str, str]:
    html = (site / 'admin' / 'index.html').read_text(encoding='utf-8')
    css = (site / 'admin' / 'admin.css').read_text(encoding='utf-8')
    html = re.sub(r'<link[^>]+>', '', html)
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S)
    html = html.replace('</head>', f'<style>{css}</style></head>')

    user = {
        'id': '11111111-1111-4111-8111-111111111111',
        'email': 'admin@example.test',
        'user_metadata': {'user_name': 'admin', 'global_name': 'Admin'},
    }
    profile = {
        'id': user['id'],
        'username': 'admin',
        'display_name': 'Admin',
        'avatar_url': None,
        'best_score': 42,
        'created_at': '2026-09-23T08:00:00Z',
        'updated_at': '2026-09-23T08:00:00Z',
    }
    overview = [{
        'tracking_started_at': '2026-09-23T12:00:00Z', 'selected_days': 30,
        'total_players': 12, 'players_with_verified_runs': 8, 'active_players': 6,
        'dau': 4, 'wau': 6, 'mau': 8, 'new_players': 3, 'lifetime_verified_runs': 420, 'window_verified_runs': 123,
        'tracked_play_ticks_total': 216000, 'window_play_ticks': 108000,
        'global_best_score': 42, 'lifetime_average_score': 5.4, 'window_average_score': 6.1,
        'pending_issued': 2, 'retained_rejected': 4, 'run_start_requests': 150,
        'issued_runs': 140, 'rejected_runs': 5, 'expired_issued_runs': 7,
        'purged_rejected_runs': 1, 'rate_limited_requests': 2, 'pending_limit_requests': 1,
        'verification_rate_pct': 87.8, 'deaths_pipe_top': 120,
        'deaths_pipe_bottom': 160, 'deaths_ground': 140,
    }]
    daily = [
        {'activity_date': '2026-09-21', 'active_players': 2, 'new_players': 1, 'verified_runs': 20, 'play_ticks': 18000, 'score_sum': 100, 'best_score': 20, 'average_score': 5, 'run_start_requests': 25, 'issued_runs': 23, 'rejected_runs': 1, 'expired_issued_runs': 1, 'purged_rejected_runs': 0, 'rate_limited_requests': 0, 'pending_limit_requests': 0},
        {'activity_date': '2026-09-22', 'active_players': 4, 'new_players': 1, 'verified_runs': 42, 'play_ticks': 36000, 'score_sum': 252, 'best_score': 31, 'average_score': 6, 'run_start_requests': 50, 'issued_runs': 47, 'rejected_runs': 2, 'expired_issued_runs': 2, 'purged_rejected_runs': 0, 'rate_limited_requests': 1, 'pending_limit_requests': 0},
        {'activity_date': '2026-09-23', 'active_players': 6, 'new_players': 1, 'verified_runs': 61, 'play_ticks': 54000, 'score_sum': 372, 'best_score': 42, 'average_score': 6.1, 'run_start_requests': 75, 'issued_runs': 70, 'rejected_runs': 2, 'expired_issued_runs': 4, 'purged_rejected_runs': 1, 'rate_limited_requests': 1, 'pending_limit_requests': 1},
    ]
    players = [{
        'global_rank': 1, 'player_id': user['id'], 'username': 'admin', 'display_name': 'Admin',
        'avatar_url': None, 'verified_runs_count': 123, 'total_score': 750, 'average_score': 6.1,
        'best_score': 42, 'best_score_at': '2026-09-23T11:00:00Z', 'tracked_play_ticks': 108000,
        'first_verified_run_at': '2026-09-20T11:00:00Z', 'last_verified_run_at': '2026-09-23T11:00:00Z',
        'deaths_pipe_top': 40, 'deaths_pipe_bottom': 43, 'deaths_ground': 40, 'pending_issued': 2,
    }]
    retention = [{
        'cohort_date': '2026-09-23', 'cohort_size': 3, 'd0_active': 2, 'd1_active': 0,
        'd7_active': 0, 'd30_active': 0, 'd0_pct': 66.7, 'd1_pct': None,
        'd7_pct': None, 'd30_pct': None,
    }]

    scripts = []
    for name in MODULE_ORDER:
        source = (site / 'src' / name).read_text(encoding='utf-8')
        source = re.sub(r'^import[\s\S]*?;\n', '', source, flags=re.M)
        source = source.replace('export ', '')
        if name == 'auth.js':
            source = source.replace('globalThis.localStorage', '__storage')
        scripts.append(source)

    harness = f"""
(function () {{
  const __user = {json.dumps(user)};
  const __profile = {json.dumps(profile)};
  const __overview = {json.dumps(overview)};
  const __daily = {json.dumps(daily)};
  const __players = {json.dumps(players)};
  const __retention = {json.dumps(retention)};
  const __store = new Map();
  __store.set('flappy13-auth-v1', JSON.stringify({{
    session: {{accessToken:'test-token', refreshToken:'test-refresh', expiresAt: Date.now() + 3600000}},
    user: __user,
    profile: __profile
  }}));
  const __storage = {{
    getItem: key => __store.has(key) ? __store.get(key) : null,
    setItem: (key, value) => __store.set(key, String(value)),
    removeItem: key => __store.delete(key),
  }};
  globalThis.FLAPPY_CONFIG = Object.freeze({{
    supabaseUrl: 'https://mock.supabase.co',
    supabasePublishableKey: 'sb_publishable_test'
  }});
  window.fetch = async input => {{
    const url = new URL(String(input), 'https://mock.supabase.co');
    let body = null;
    if (url.pathname === '/auth/v1/user') body = __user;
    else if (url.pathname === '/rest/v1/profiles') body = [__profile];
    else if (url.pathname.endsWith('/rpc/is_analytics_admin')) body = true;
    else if (url.pathname.endsWith('/rpc/admin_analytics_overview')) body = __overview;
    else if (url.pathname.endsWith('/rpc/admin_analytics_daily')) body = __daily;
    else if (url.pathname.endsWith('/rpc/admin_analytics_players')) body = __players;
    else if (url.pathname.endsWith('/rpc/admin_analytics_retention')) body = __retention;
    else return new Response(JSON.stringify({{message:'Not mocked'}}), {{status:404, headers:{{'Content-Type':'application/json'}}}});
    return new Response(JSON.stringify(body), {{status:200, headers:{{'Content-Type':'application/json'}}}});
  }};

  {'\n'.join(scripts)}
}})();
"""
    return html, harness


def main() -> None:
    args = parse_args()
    root = Path(__file__).resolve().parents[1]
    site = root / 'site'
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    html, script = build_page(site)

    with sync_playwright() as playwright:
        launch = {'headless': True}
        if args.chromium:
            launch['executable_path'] = args.chromium
        browser = playwright.chromium.launch(**launch)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        page = context.new_page()
        errors: list[str] = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content(html)
        page.evaluate(script)
        page.wait_for_selector('#dashboard:not([hidden])')
        assert page.locator('#auth-gate').is_hidden()

        assert page.locator('#kpi-players').inner_text() == '12'
        assert page.locator('#kpi-runs').inner_text() == '123'
        assert page.locator('#kpi-record').inner_text() == '42'
        assert page.locator('#runs-chart svg').count() == 1
        assert page.locator('#active-chart svg').count() == 1

        page.click('[data-section="players"]')
        assert page.locator('#players-body tr').count() == 1
        assert 'Admin' in page.locator('#players-body tr').inner_text()

        page.click('[data-section="retention"]')
        assert page.locator('#retention-body tr').count() == 1
        assert '66,7' in page.locator('#retention-body tr').inner_text()

        page.click('[data-section="system"]')
        assert page.locator('#sys-starts').inner_text() == '150'
        assert page.locator('#system-chart svg').count() == 1

        page.screenshot(path=str(output / 'dashboard.png'), full_page=True)
        assert not errors, errors
        context.close()
        browser.close()

    report = {
        'environment': 'Isolated Chromium DOM + mocked Supabase Auth/RPCs',
        'errors': errors,
        'overview': 'OK',
        'players': 'OK',
        'retention': 'OK',
        'system': 'OK',
        'realSupabase': 'NOT_TESTED',
    }
    (output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
