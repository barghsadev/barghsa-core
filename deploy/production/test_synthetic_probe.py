import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.parse import parse_qs, urlsplit


OBSERVER = Path(__file__).with_name('rollout-observer.py')
USER = '00000000-0000-4000-8000-000000000001'
PROFILE = '00000000-0000-4000-8000-000000000002'
CHALLENGE = '00000000-0000-4000-8000-000000000003'
CORRELATION = '00000000-0000-4000-8000-000000000004'
FIXTURE = '00000000-0000-4000-8000-000000000005'
PASSWORD = 'synthetic-only-password'
BEARER = 'synthetic-session-bearer'
DEVICE = 'd' * 64
CSRF = 'f' * 64
JOURNEYS = {
    'electricity': ('/api/electricity/orders', 'orders', 'orderId'),
    'saving': ('/api/saving/orders', 'orders', 'id'),
    'solar': ('/api/solar/requests', 'requests', 'id'),
    'consultation': ('/api/consultations/requests', 'requests', 'id'),
}


class SyntheticProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.calls = []
        self.fault = ''
        self.issue_otp = False
        self.csrf_counter = 0
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def response(self, value, code=200, cookies=(), extra=()):
                payload = json.dumps(value).encode()
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('X-Correlation-Id', CORRELATION)
                for cookie in cookies:
                    self.send_header('Set-Cookie', cookie)
                for header, data in extra:
                    self.send_header(header, data)
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self):
                parsed = urlsplit(self.path)
                path = parsed.path
                fixture.calls.append(('GET', path))
                cookie = self.headers.get('Cookie', '')
                if path in ('/api/health/live', '/api/health/ready'):
                    if cookie:
                        return self.response({}, 403)
                    return self.response({'status': 'ok'}, 503 if fixture.fault == 'health' else 200)
                if path == '/api/auth/csrf':
                    if f'barghsa_session={BEARER}' in cookie:
                        return self.response({'csrfToken': CSRF})
                    fixture.csrf_counter += 1
                    return self.response(
                        {'csrfToken': str(fixture.csrf_counter) * 64},
                        cookies=(f'barghsa_preauth=attempt{fixture.csrf_counter}; Path=/; HttpOnly',),
                    )
                if f'barghsa_session={BEARER}' not in cookie:
                    return self.response({}, 401)
                if path == '/api/auth/user':
                    return self.response({
                        'userId': USER, 'isStaff': fixture.fault == 'staff',
                        'operatingContext': 'customer',
                        'navigation': {'profileId': PROFILE if fixture.fault != 'wrong_profile' else USER},
                    })
                if path == '/api/profiles':
                    profiles = [{'id': PROFILE, 'isDefault': fixture.fault != 'delegated_profile'}]
                    if fixture.fault == 'additional_profile':
                        profiles.append({'id': USER, 'isDefault': False})
                    return self.response({'activeProfileId': PROFILE, 'profiles': profiles})
                for route, collection, key in JOURNEYS.values():
                    if path == route and parse_qs(parsed.query) == {'profileId': [PROFILE]}:
                        if fixture.fault == 'missing_fixture' and path == JOURNEYS['solar'][0]:
                            return self.response({collection: [{key: PROFILE}]})
                        return self.response({collection: [{key: FIXTURE, 'private': PASSWORD}]})
                return self.response({}, 404)

            def do_POST(self):
                fixture.calls.append(('POST', self.path))
                if self.headers.get('Origin') != fixture.origin:
                    return self.response({}, 403)
                token = self.headers.get('X-CSRF-Token', '')
                cookies = self.headers.get('Cookie', '')
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
                if self.path == '/api/auth/logout':
                    if token != CSRF or f'barghsa_session={BEARER}' not in cookies or body:
                        return self.response({}, 403)
                    return self.response({}, cookies=(
                        'barghsa_session=; Path=/; Max-Age=0',
                        'barghsa_refresh=; Path=/api/auth; Max-Age=0',
                    ))
                if token != str(fixture.csrf_counter) * 64 or f'barghsa_preauth=attempt{fixture.csrf_counter}' not in cookies:
                    return self.response({}, 403)
                if self.path == '/api/auth/login':
                    if body != {'username': 'probe@example.test', 'password': PASSWORD}:
                        return self.response({}, 401)
                    if fixture.fault == 'redirect':
                        return self.response({}, 302, extra=(('Location', fixture.origin + '/foreign'),))
                    if fixture.issue_otp:
                        return self.response({'requiresOtp': True, 'challengeId': CHALLENGE})
                    if f'barghsa_device={DEVICE}' not in cookies:
                        return self.response({}, 403)
                elif self.path == '/api/auth/login/verify':
                    if body != {'challengeId': CHALLENGE, 'otp': '417806', 'trustDevice': False}:
                        return self.response({}, 401)
                else:
                    return self.response({}, 404)
                return self.response({
                    'requiresOtp': False,
                    'userId': PROFILE if fixture.fault == 'wrong_login' else USER,
                    'csrfToken': None if fixture.fault == 'missing_csrf' else CSRF,
                }, cookies=(
                    f'barghsa_session={BEARER}; Path=/; HttpOnly',
                    'barghsa_refresh=synthetic-refresh; Path=/api/auth; HttpOnly',
                ))

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.origin = f'http://127.0.0.1:{self.server.server_port}'
        self.thread = None
        self.addCleanup(self.server.server_close)
        self.config = {
            'origin': self.origin,
            'user_id': USER, 'profile_id': PROFILE,
            'fixtures': dict.fromkeys(JOURNEYS, FIXTURE),
            'username': 'probe@example.test', 'password': PASSWORD, 'device_token': DEVICE,
        }

    def serve_tls(self):
        cert = self.directory / 'fixture.pem'
        key = self.directory / 'key.pem'
        settings = self.directory / 'openssl.cnf'
        settings.write_text('[req]\nprompt = no\ndistinguished_name = subject\nx509_extensions = extensions\n'
                            '[subject]\nCN = Barghsa TLS fixture\n[extensions]\n'
                            'subjectAltName = IP:127.0.0.1\nbasicConstraints = critical,CA:TRUE\n')
        subprocess.run(['openssl', 'req', '-new', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-days', '7', '-config', str(settings), '-keyout', str(key), '-out', str(cert)],
                       check=True, capture_output=True, timeout=8)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        self.server.socket = context.wrap_socket(self.server.socket, server_side=True)
        self.origin = f'https://127.0.0.1:{self.server.server_port}'
        self.config['origin'] = self.origin
        return cert

    def probe(self, mode=0o600, *, trust=None):
        if self.thread is None:
            self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
            self.thread.start()
            self.addCleanup(self.server.shutdown)
        config = self.directory / 'probe.json'
        config.write_text(json.dumps(self.config))
        config.chmod(mode)
        self.metrics = self.directory / 'probe.prom'
        command = [sys.executable]
        if trust:
            # Use the fixture CA on platforms whose default trust loader ignores SSL_CERT_FILE.
            command.extend(['-c', '''
import runpy, ssl, sys

fixture_ca = sys.argv.pop(1)
load_default_certs = ssl.SSLContext.load_default_certs

def load_fixture_ca(context, purpose=ssl.Purpose.SERVER_AUTH):
    load_default_certs(context, purpose)
    context.load_verify_locations(cafile=fixture_ca)

ssl.SSLContext.load_default_certs = load_fixture_ca
runpy.run_path(sys.argv.pop(1), run_name='__main__')
''', str(trust)])
        return subprocess.run(
            [*command, str(OBSERVER), '--synthetic', '--config', str(config),
             '--metrics-file', str(self.metrics)],
            text=True, capture_output=True, timeout=12,
        )

    def check_report(self, result):
        self.assertEqual(result.stderr, '')
        self.assertTrue(self.metrics.is_file())
        for protected in (USER, PROFILE, CHALLENGE, FIXTURE, PASSWORD, BEARER, DEVICE, CSRF):
            self.assertNotIn(protected, result.stdout + self.metrics.read_text())
        return json.loads(result.stdout)['checks']

    def test_trusted_device_reads_only_the_dedicated_fixtures_and_logs_out(self):
        result = self.probe()
        self.assertEqual(result.returncode, 0, result.stderr)
        checks = self.check_report(result)
        self.assertEqual({row['status'] for row in checks.values()}, {'passed'})
        self.assertEqual(checks['login']['correlation_id'], CORRELATION)
        self.assertGreaterEqual(checks['solar']['duration_ms'], 0)
        self.assertEqual(self.calls, [
            ('GET', '/api/health/live'), ('GET', '/api/health/ready'),
            ('GET', '/api/auth/csrf'), ('POST', '/api/auth/login'),
            ('GET', '/api/auth/user'), ('GET', '/api/profiles'),
            *(('GET', route[0]) for route in JOURNEYS.values()),
            ('POST', '/api/auth/logout'),
        ])
        self.assertIn('barghsa_synthetic_probe_success{check="solar"} 1', self.metrics.read_text())
        self.assertNotIn('certificate_expiry', self.metrics.read_text())

    def test_reports_only_a_verified_public_certificate_and_replaces_stale_results(self):
        cert = self.serve_tls()
        self.fault = 'health'
        trusted = self.probe(trust=cert)
        self.assertEqual(trusted.returncode, 1)
        self.assertEqual(self.check_report(trusted)['liveness']['http_status'], 503)
        report = json.loads(trusted.stdout)
        expiry = report['tls_certificate_expiry_timestamp_seconds']
        self.assertAlmostEqual(expiry - report['observed_at'], 7 * 86400, delta=15)
        metric = 'barghsa_synthetic_probe_tls_certificate_expiry_timestamp_seconds'
        self.assertIn(f'{metric} {expiry}\n', self.metrics.read_text())

        for base, trust in [(self.origin, None), (self.origin.replace('127.0.0.1', 'localhost'), cert)]:
            with self.subTest(base=base):
                self.config['origin'] = base
                rejected = self.probe(trust=trust)
                self.assertEqual(rejected.returncode, 1)
                self.assertEqual(self.check_report(rejected)['liveness']['reason'], 'probe_unavailable')
                self.assertNotIn('tls_certificate_expiry_timestamp_seconds', rejected.stdout)
                self.assertNotIn(metric, self.metrics.read_text())

    def test_otp_uses_a_fresh_csrf_proof_and_does_not_trust_a_new_device(self):
        self.issue_otp = True
        reader = self.directory / 'otp-reader'
        reader.write_text(
            '#!/usr/bin/env python3\nimport json,sys\n'
            f'assert json.load(sys.stdin)["challengeId"] == "{CHALLENGE}"\n'
            'print("417806")\n'
        )
        reader.chmod(0o700)
        self.config.pop('device_token')
        self.config['otp_reader'] = str(reader)
        result = self.probe()
        self.assertEqual(result.returncode, 0, result.stderr)
        checks = self.check_report(result)
        self.assertEqual(checks['login']['status'], 'passed')
        self.assertEqual(self.calls[2:6], [
            ('GET', '/api/auth/csrf'), ('POST', '/api/auth/login'),
            ('GET', '/api/auth/csrf'), ('POST', '/api/auth/login/verify'),
        ])
        self.assertNotIn('417806', result.stdout + self.metrics.read_text())

    def test_an_unexpected_session_or_profile_stops_all_domain_reads(self):
        for fault in ('wrong_login', 'missing_csrf', 'wrong_profile', 'staff'):
            with self.subTest(fault=fault):
                self.fault = fault
                self.calls.clear()
                result = self.probe()
                self.assertEqual(result.returncode, 1)
                checks = self.check_report(result)
                self.assertEqual(checks['electricity']['status'], 'skipped')
                self.assertEqual(checks['logout']['status'], 'passed')
                self.assertNotIn(('GET', JOURNEYS['electricity'][0]), self.calls)
                self.assertNotIn('check="electricity"', self.metrics.read_text())

    def test_rejects_an_account_with_multiple_profiles_or_delegated_access(self):
        for fault in ('additional_profile', 'delegated_profile'):
            with self.subTest(fault=fault):
                self.fault = fault
                self.calls.clear()
                result = self.probe()
                self.assertEqual(result.returncode, 1)
                checks = self.check_report(result)
                self.assertEqual(checks['account']['reason'], 'fixture_profile_not_isolated')
                self.assertTrue(all(checks[name]['status'] == 'skipped' for name in JOURNEYS))
                self.assertEqual(checks['logout']['status'], 'passed')
                self.assertEqual(self.calls[-2:], [('GET', '/api/profiles'), ('POST', '/api/auth/logout')])
                self.assertNotIn('check="electricity"', self.metrics.read_text())

    def test_read_failure_does_not_hide_other_journeys_or_skip_logout(self):
        self.fault = 'missing_fixture'
        result = self.probe()
        self.assertEqual(result.returncode, 1)
        checks = self.check_report(result)
        self.assertEqual(checks['solar']['reason'], 'fixture_unavailable')
        self.assertEqual(checks['consultation']['status'], 'passed')
        self.assertEqual(checks['logout']['status'], 'passed')
        self.assertIn('barghsa_synthetic_probe_success{check="solar"} 0', self.metrics.read_text())

    def test_failed_health_and_login_redirect_do_not_send_follow_up_authentication(self):
        for fault in ('health', 'redirect'):
            with self.subTest(fault=fault):
                self.fault = fault
                self.calls.clear()
                result = self.probe()
                self.assertEqual(result.returncode, 1)
                checks = self.check_report(result)
                self.assertNotIn(('GET', '/foreign'), self.calls)
                self.assertNotIn(('GET', '/api/auth/user'), self.calls)
                if fault == 'health':
                    self.assertNotIn(('POST', '/api/auth/login'), self.calls)
                else:
                    self.assertEqual(checks['login']['http_status'], 302)
                    self.assertEqual(checks['login']['correlation_id'], CORRELATION)

    def test_group_readable_configuration_stops_before_network_access(self):
        result = self.probe(0o640)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr.strip(), 'unsafe_configuration_permissions')
        self.assertEqual(self.calls, [])
        self.assertFalse(self.metrics.exists())


if __name__ == '__main__':
    unittest.main()
