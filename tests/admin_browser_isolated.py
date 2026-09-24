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
    'auth/provider-profile.js',
    'api/profile-client.js',
    'auth/identity-linking.js',
    'auth.js',
    'ui/avatar-fallback.js',
    'admin/analytics-client.js',
    'admin/charts.js',
    'admin/day-view.js',
    'admin/player-detail.js',
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
        'tracking_started_at': '2026-09-20T12:00:00Z', 'selected_from': '2026-08-26',
        'selected_to': '2026-09-24', 'selected_days': 30,
        'total_players': 12, 'players_with_verified_runs': 8, 'active_players': 6,
        'new_players': 3, 'new_active_players': 2, 'returning_active_players': 4,
        'dau': 4, 'wau': 6, 'mau': 8, 'lifetime_verified_runs': 420, 'window_verified_runs': 123,
        'tracked_play_ticks_total': 216000, 'window_play_ticks': 108000,
        'global_best_score': 42, 'period_best_score': 42, 'lifetime_average_score': 5.4,
        'window_average_score': 6.1, 'runs_per_active_player': 20.5, 'play_ticks_per_active_player': 18000,
        'pending_issued': 2, 'retained_rejected': 4, 'run_start_requests': 150,
        'issued_runs': 140, 'rejected_runs': 5, 'expired_issued_runs': 7,
        'purged_rejected_runs': 1, 'rate_limited_requests': 2, 'pending_limit_requests': 1,
        'issue_rate_pct': 93.3, 'verification_rate_pct': 87.8, 'rejection_rate_pct': 3.6,
        'deaths_pipe_top': 120, 'deaths_pipe_bottom': 160, 'deaths_ground': 140,
    }]
    daily = [
        {'activity_date': '2026-09-21', 'active_players': 2, 'new_active_players': 1, 'returning_players': 1, 'dau': 2, 'wau': 2, 'mau': 2, 'new_players': 1, 'verified_runs': 20, 'play_ticks': 18000, 'score_sum': 100, 'best_score': 20, 'average_score': 5, 'run_start_requests': 25, 'issued_runs': 23, 'rejected_runs': 1, 'expired_issued_runs': 1, 'purged_rejected_runs': 0, 'rate_limited_requests': 0, 'pending_limit_requests': 0},
        {'activity_date': '2026-09-22', 'active_players': 4, 'new_active_players': 1, 'returning_players': 3, 'dau': 4, 'wau': 4, 'mau': 4, 'new_players': 1, 'verified_runs': 42, 'play_ticks': 36000, 'score_sum': 252, 'best_score': 31, 'average_score': 6, 'run_start_requests': 50, 'issued_runs': 47, 'rejected_runs': 2, 'expired_issued_runs': 2, 'purged_rejected_runs': 0, 'rate_limited_requests': 1, 'pending_limit_requests': 0},
        {'activity_date': '2026-09-23', 'active_players': 6, 'new_active_players': 0, 'returning_players': 6, 'dau': 6, 'wau': 6, 'mau': 6, 'new_players': 1, 'verified_runs': 61, 'play_ticks': 54000, 'score_sum': 372, 'best_score': 42, 'average_score': 6.1, 'run_start_requests': 75, 'issued_runs': 70, 'rejected_runs': 2, 'expired_issued_runs': 4, 'purged_rejected_runs': 1, 'rate_limited_requests': 1, 'pending_limit_requests': 1},
    ]
    players = [{
        'global_rank': 1, 'player_id': user['id'], 'username': 'admin', 'display_name': 'Admin',
        'avatar_url': None, 'period_verified_runs': 123, 'period_total_score': 750,
        'period_average_score': 6.1, 'period_best_score': 42, 'period_play_ticks': 108000,
        'period_active_days': 3, 'period_first_run_at': '2026-09-21T11:00:00Z',
        'period_last_run_at': '2026-09-23T11:00:00Z', 'lifetime_verified_runs': 420,
        'lifetime_best_score': 42, 'tracked_play_ticks': 216000, 'pending_issued': 2,
    }]
    retention = [{
        'cohort_date': '2026-09-23', 'cohort_size': 3, 'd0_active': 2, 'd1_active': 0,
        'd7_active': 0, 'd30_active': 0, 'd0_pct': 66.7, 'd1_pct': None,
        'd7_pct': None, 'd30_pct': None,
    }]
    player_detail = {
        'selected_from': '2026-09-21', 'selected_to': '2026-09-23',
        'profile': {
            'player_id': user['id'], 'username': 'admin', 'display_name': 'Admin',
            'avatar_url': None, 'avatar_provider': 'discord',
            'created_at': '2026-09-20T08:00:00Z', 'last_sign_in_at': '2026-09-24T19:00:00Z',
            'profile_updated_at': '2026-09-23T08:00:00Z',
        },
        'identities': [
            {'provider': 'discord', 'provider_label': 'AdminBird', 'linked_at': '2026-09-20T08:00:00Z', 'last_sign_in_at': '2026-09-24T19:00:00Z'},
            {'provider': 'google', 'provider_label': 'Admin Google', 'linked_at': '2026-09-22T08:00:00Z', 'last_sign_in_at': '2026-09-24T18:00:00Z'},
        ],
        'lifetime': {
            'global_rank': 1, 'verified_runs': 420, 'total_score': 2268, 'average_score': 5.4,
            'best_score': 42, 'best_run_id': 'run-best', 'best_score_at': '2026-09-23T10:00:00Z',
            'first_verified_run_at': '2026-09-20T09:00:00Z', 'last_verified_run_at': '2026-09-24T20:00:00Z',
            'tracked_play_ticks': 216000, 'tracked_verified_runs': 300, 'tracked_active_days': 5,
            'average_run_ticks_tracked': 720, 'deaths_pipe_top': 120, 'deaths_pipe_bottom': 160, 'deaths_ground': 140,
        },
        'period': {
            'verified_runs': 123, 'total_score': 750, 'average_score': 6.1, 'best_score': 42,
            'play_ticks': 108000, 'average_run_ticks': 878, 'active_days': 3,
            'average_play_ticks_per_active_day': 36000,
            'first_run_at': '2026-09-21T11:00:00Z', 'last_run_at': '2026-09-23T11:00:00Z',
        },
        'retention': {'d0': True, 'd1': True, 'd7': None, 'd30': None},
        'pending': {'issued': 2, 'rejected': 1},
        'activity': daily,
        'recent_runs': [
            {'run_id': 'run-1', 'status': 'verified', 'score': 42, 'collision': 'ground', 'terminal_tick': 720,
             'issued_at': '2026-09-23T10:00:00Z', 'resolved_at': '2026-09-23T10:01:00Z', 'theme': 'france', 'variant': 'night'}
        ],
    }
    day_overview = [{
        'selected_date': '2026-09-24', 'tracking_started_at': '2026-09-20T12:00:00Z',
        'hourly_tracking_started_at': '2026-09-24T18:00:00Z', 'active_players': 5, 'new_players': 2,
        'new_active_players': 1, 'returning_players': 4, 'verified_runs': 48, 'play_ticks': 43200,
        'score_sum': 300, 'best_score': 36, 'average_score': 6.25, 'run_start_requests': 60,
        'issued_runs': 56, 'rejected_runs': 2, 'expired_issued_runs': 1, 'purged_rejected_runs': 0,
        'rate_limited_requests': 1, 'pending_limit_requests': 1, 'issue_rate_pct': 93.3,
        'verification_rate_pct': 85.7, 'rejection_rate_pct': 3.6,
        'first_run_at': '2026-09-24T08:05:00Z', 'last_run_at': '2026-09-24T21:50:00Z',
    }]
    day_hourly = []
    for hour in range(24):
        active = 5 if hour == 20 else (2 if 18 <= hour <= 22 else 0)
        runs = 14 if hour == 20 else (6 if 18 <= hour <= 22 else 0)
        day_hourly.append({
            'activity_hour': f'2026-09-24T{hour:02d}:00:00Z', 'hour_index': hour,
            'active_players': active, 'new_players': 1 if hour == 19 else 0, 'verified_runs': runs,
            'play_ticks': runs * 900, 'score_sum': runs * 6, 'best_score': 36 if hour == 20 else (12 if runs else 0),
            'average_score': 6 if runs else None, 'deaths_pipe_top': 3 if hour == 20 else 0,
            'deaths_pipe_bottom': 5 if hour == 20 else 0, 'deaths_ground': 6 if hour == 20 else 0,
            'run_start_requests': 18 if hour == 20 else runs + 1, 'issued_runs': 16 if hour == 20 else runs,
            'rejected_runs': 1 if hour == 20 else 0, 'expired_issued_runs': 0, 'purged_rejected_runs': 0,
            'rate_limited_requests': 1 if hour == 20 else 0, 'pending_limit_requests': 0,
        })
    day_recent = [{
        'run_id': 'run-day', 'player_id': user['id'], 'username': 'admin', 'display_name': 'Admin',
        'avatar_url': None, 'score': 36, 'collision': 'ground', 'terminal_tick': 700,
        'resolved_at': '2026-09-24T20:32:00Z', 'visual_theme': 'original', 'visual_variant': 'day',
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
  const __playerDetail = {json.dumps(player_detail)};
  const __dayOverview = {json.dumps(day_overview)};
  const __dayHourly = {json.dumps(day_hourly)};
  const __dayRecent = {json.dumps(day_recent)};
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
    else if (url.pathname.endsWith('/rpc/admin_analytics_overview_range')) body = __overview;
    else if (url.pathname.endsWith('/rpc/admin_analytics_daily_range')) body = __daily;
    else if (url.pathname.endsWith('/rpc/admin_analytics_players_range')) body = __players;
    else if (url.pathname.endsWith('/rpc/admin_analytics_retention_range')) body = __retention;
    else if (url.pathname.endsWith('/rpc/admin_analytics_player_detail')) body = __playerDetail;
    else if (url.pathname.endsWith('/rpc/admin_analytics_day_overview')) body = __dayOverview;
    else if (url.pathname.endsWith('/rpc/admin_analytics_day_hourly')) body = __dayHourly;
    else if (url.pathname.endsWith('/rpc/admin_analytics_day_recent_runs')) body = __dayRecent;
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
        assert page.locator('#kpi-period-average').inner_text() == '6,1'
        assert 'global 42' in page.locator('#kpi-records').inner_text()
        assert page.locator('#runs-chart svg').count() == 1
        assert page.locator('#active-chart svg').count() == 1
        assert page.locator('#playtime-chart svg').count() == 1
        assert page.locator('#score-chart svg').count() == 1

        # Quick presets and explicit from/to controls are wired in the browser.
        page.click('[data-period="yesterday"]')
        page.wait_for_timeout(20)
        assert page.locator('#period-from').input_value() == page.locator('#period-to').input_value()
        page.fill('#period-from', '2026-09-21')
        page.fill('#period-to', '2026-09-23')
        page.click('#period-form button[type="submit"]')
        page.wait_for_timeout(20)
        assert '21/09/2026' in page.locator('#period-summary').inner_text()
        assert '23/09/2026' in page.locator('#period-summary').inner_text()

        page.click('[data-section="players"]')
        assert page.locator('#players-body tr').count() == 1
        assert 'Admin' in page.locator('#players-body tr').inner_text()
        page.click('#players-body tr')
        page.wait_for_selector('#player-detail-dialog[open]')
        page.wait_for_selector('#player-detail-content:not([hidden])')
        assert page.locator('#pd-identities .identity-item').count() == 2
        assert 'Discord' in page.locator('#pd-identities').inner_text()
        assert 'Google' in page.locator('#pd-identities').inner_text()
        assert page.locator('#pd-lifetime-runs').inner_text() == '420'
        assert '1m' in page.locator('#pd-lifetime-run-time').inner_text() or '12s' in page.locator('#pd-lifetime-run-time').inner_text()
        assert page.locator('#pd-activity-chart svg').count() == 1
        page.screenshot(path=str(output / 'player-detail.png'), full_page=True)
        page.click('#player-detail-close')

        page.click('[data-section="day"]')
        page.wait_for_timeout(30)
        assert page.locator('#period-form').is_hidden() or page.locator('.period-card').is_hidden()
        assert page.locator('#day-active').inner_text() == '5'
        assert page.locator('#day-runs').inner_text() == '48'
        assert page.locator('#day-active-chart svg').count() == 1
        assert page.locator('#day-runs-chart svg').count() == 1
        assert '20 h' in page.locator('#day-peak-active').inner_text()
        assert page.locator('#day-players-body tr').count() == 1
        assert page.locator('#day-runs-body tr').count() == 1
        page.screenshot(path=str(output / 'day.png'), full_page=True)

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
        'playerDetail': 'OK',
        'day': 'OK',
        'players': 'OK',
        'retention': 'OK',
        'system': 'OK',
        'realSupabase': 'NOT_TESTED',
    }
    (output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
