from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import Thread
import time
import unittest
from urllib.parse import parse_qs, urlsplit


SCRIPT = Path(__file__).with_name('rollout-observer.py')
SCOPE = {'environment': 'rehearsal', 'database': 'core'}
SERVICES = {
    '/api/electricity/orders': ('electricity', None, 'orderId', 'profileId'),
    '/api/saving/orders': ('saving', None, 'id', 'profile_id'),
    '/api/solar/requests': ('solar', 'request', 'id', 'profile_id'),
    '/api/consultations/requests': ('consultation', 'request', 'id', 'profile_id'),
}
BUCKETS = ('0.005', '0.01', '0.025', '0.05', '0.1', '0.25', '0.5', '1', '2', '5', '10', '+Inf')
WALLET_FIXTURE_BALANCE = '8901234567890123456'


def revision(letter):
    return {'commit': letter * 40, 'app_image': 'sha256:' + letter * 64, 'web_image': 'sha256:' + 'e' * 64}


def fixture_id(number):
    return f'01234567-0123-0123-0123-{number:012d}'


class Rehearsal:
    def __init__(self):
        self.config = {
            'scope': SCOPE,
            'candidate': {'revision': revision('a'), 'api_job': 'candidate-api', 'journey_job': 'candidate-probes'},
            'previous': {'revision': revision('b'), 'api_job': 'previous-api', 'journey_job': 'previous-probes'},
            'targets': {name: ['instance-1'] for name in
                        ('candidate-api', 'previous-api', 'candidate-probes', 'previous-probes', 'wallet-worker')},
            'max_scrape_age_seconds': 5, 'wallet_job': 'wallet-worker',
            'user_id': fixture_id(1), 'profile_id': fixture_id(2),
            'fixtures': {service: fixture_id(i) for i, (service, *_) in enumerate(SERVICES.values(), 3)},
            'session_id': 'rehearsal-private-session', 'prometheus_token': 'rehearsal-private-monitoring',
        }
        self.fault = ''
        self.requests = []

    def metrics(self, query, timestamp):
        jobs = re.search(r'job=~"([^"]+)"', query)[1].split('|')
        assert 'environment="rehearsal"' in query and 'database="core"' in query
        end = int(timestamp) - 1
        times = range(end - 12, end + 1)
        series = []

        def add(name, values, **labels):
            series.append({'metric': {'__name__': name, **SCOPE, 'job': job,
                                      'instance': 'instance-1', **labels},
                           'values': list(zip(times, map(str, values)))})

        for job in jobs:
            commit = revision('a' if job.startswith('candidate') else 'b')['commit']
            add('up', [1] * 12 + [0 if job == 'candidate-api' and self.fault == 'scrape-down' else 1])
            if job.endswith('-api'):
                api_sha = 'c' * 40 if job == 'candidate-api' and self.fault == 'mixed-release' else commit
                role = 'api' if self.fault != 'missing-previous-api-role' or job != 'previous-api' else 'unknown'
                add('barghsa_api_release_info', [1] * 13, revision=api_sha, barghsa_role=role)
                add('node_process_start_time_seconds',
                    [42] * 12 + [44 if self.fault == 'api-restarted' else 42])
                scale = 20 if self.fault in ('p99-volume', 'p99-unbounded') else 1
                for status, counts, latency in (
                    ('200', [10] * 12 + [1] if self.fault == 'reset' else [20 * i * scale for i in range(13)], 0.25),
                    ('503', [i * scale for i in range(13)], 0.5),
                ):
                    labels = {'route': '/api/example', 'method': 'GET', 'status': status}
                    add('barghsa_http_request_duration_seconds_count', counts, **labels)
                    if 'barghsa_http_request_duration_seconds_bucket' not in query:
                        continue
                    for bound in BUCKETS:
                        if bound == '0.25' and self.fault == 'missing-bucket':
                            continue
                        unbounded = self.fault == 'tail-latency' or (self.fault == 'p99-unbounded' and status == '503')
                        minimum = float('inf') if unbounded else latency
                        if self.fault == 'nonmonotonic-latency' and bound == '0.05':
                            minimum = 0
                        values = counts if float(bound) >= minimum else [0] * 13
                        if self.fault == 'wrong-total-bucket' and bound == '+Inf':
                            values = [0] * 13
                        add('barghsa_http_request_duration_seconds_bucket', values, le=bound, **labels)
            if job in {self.config[pool]['journey_job'] for pool in ('candidate', 'previous')}:
                if not job.endswith('-api'):
                    add('process_start_time_seconds', [43] * 13)
                for service, *_ in SERVICES.values():
                    if self.fault == 'missing-solar' and service == 'solar':
                        continue
                    add('barghsa_rollout_journey_attempts_total', range(0, 26, 2),
                        service=service, outcome='success', revision=commit)
                    add('barghsa_rollout_journey_attempts_total', [0] * 13,
                        service=service, outcome='failure', revision=commit)
            if job == 'wallet-worker':
                add('reconciliation_wallets_critical_drift', [0] * 12 + [int(self.fault == 'wallet-drift')])
        return {'status': 'success', 'data': {'resultType': 'matrix', 'result': series}}

    def rules(self):
        rules = []
        for name in ('PaymentCallbackAnomaly', 'PaymentIdempotencyConflict', 'AuthenticationFailuresElevated'):
            auth_rule = name == 'AuthenticationFailuresElevated'
            if auth_rule and self.fault == 'missing-auth-rule':
                continue
            evaluated = time.time() - (20 if self.fault == 'stale-security-rule' else 0.5)
            alerts = []
            if self.fault == 'security-alert' and not auth_rule:
                alerts = [{'state': 'pending', 'labels': SCOPE}]
            if auth_rule and self.fault in ('auth-alert', 'foreign-auth-alert'):
                scope = SCOPE if self.fault == 'auth-alert' else {**SCOPE, 'database': 'other'}
                alerts = [{'state': 'pending', 'labels': scope}]
            timestamp = datetime.fromtimestamp(evaluated, timezone.utc).isoformat(timespec='microseconds')
            rules.append({'name': name, 'type': 'alerting', 'health': 'ok',
                          'lastEvaluation': timestamp.replace('+00:00', '987Z'),
                          'alerts': alerts})
        return {'status': 'success', 'data': {'groups': [{'rules': rules}]}}

    def server(self, kind):
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                parsed = urlsplit(self.path)
                path, params = parsed.path, parse_qs(parsed.query)
                cookie = self.headers.get('Cookie')
                token = self.headers.get('Authorization')
                fixture.requests.append((kind, path, cookie, token))
                if kind == 'monitoring':
                    if token != 'Bearer ' + fixture.config['prometheus_token'] or cookie:
                        self.send_error(401)
                        return
                    payload = (fixture.metrics(params['query'][0], float(params['time'][0]))
                               if path == '/api/v1/query' else fixture.rules())
                elif path == '/release.json':
                    payload = {'commit': fixture.config[kind]['revision']['commit']}
                elif path == '/api/health/live':
                    payload = {'status': 'ok'}
                elif path == '/api/health/ready':
                    if kind == 'candidate' and fixture.fault == 'database-down':
                        self.send_error(503)
                        return
                    payload = {'status': 'ok', 'checks': {'postgresql': {'status': 'ok'}}}
                    if fixture.fault != f'{kind}-api-revision-missing':
                        payload['commit'] = ('c' * 40 if fixture.fault == f'{kind}-api-revision-wrong'
                                             else fixture.config[kind]['revision']['commit'])
                elif kind != 'candidate' or cookie != 'barghsa_session=' + fixture.config['session_id'] or token:
                    self.send_error(401)
                    return
                elif path == '/api/auth/user':
                    if fixture.fault == 'redirect':
                        self.send_response(302)
                        self.send_header('Location', fixture.config['previous']['origin'] + '/api/auth/user')
                        self.end_headers()
                        return
                    profile = fixture_id(999) if fixture.fault == 'foreign-profile' else fixture.config['profile_id']
                    payload = {'userId': fixture.config['user_id'], 'isStaff': False,
                               'operatingContext': 'customer', 'navigation': {'profileId': profile}}
                elif path == '/api/profiles':
                    profile = fixture.config['profile_id']
                    profiles = [{'id': profile, 'isDefault': fixture.fault != 'delegated-profile'}]
                    if fixture.fault == 'additional-profile':
                        profiles.append({'id': fixture_id(999), 'isDefault': False})
                    payload = {'activeProfileId': profile, 'profiles': profiles}
                elif path == '/api/dashboard/context':
                    profile = fixture_id(999) if fixture.fault == 'foreign-dashboard' else fixture.config['profile_id']
                    payload = {'profile': {'id': profile}, 'access': {'wallet': True}}
                elif path == '/api/wallet/' + fixture.config['profile_id']:
                    payload = {'currency': 'IRR',
                               'balance': 'unavailable' if fixture.fault == 'invalid-wallet' else WALLET_FIXTURE_BALANCE}
                else:
                    route, _, record_id = path.rpartition('/')
                    if route not in SERVICES or params:
                        self.send_error(404)
                        return
                    service, envelope, record_key, profile_key = SERVICES[route]
                    if record_id != fixture.config['fixtures'][service] or fixture.fault == 'missing-' + service:
                        self.send_error(404)
                        return
                    row_id = fixture_id(999) if fixture.fault == 'foreign-' + service else record_id
                    profile = fixture_id(999) if fixture.fault == 'foreign-owner-' + service else fixture.config['profile_id']
                    record = {record_key: row_id, profile_key: profile}
                    payload = {envelope: record} if envelope else record
                body = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
        return server


class ObserverTest(unittest.TestCase):
    def setUp(self):
        self.rehearsal = Rehearsal()
        for kind in ('candidate', 'previous', 'monitoring'):
            server = self.rehearsal.server(kind)
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
            origin = f'http://127.0.0.1:{server.server_port}'
            if kind == 'monitoring':
                self.rehearsal.config['prometheus_origin'] = origin
            else:
                self.rehearsal.config[kind]['origin'] = origin
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.config_file = Path(directory.name) / 'observer.json'
        self.config_file.touch(mode=0o600)

    def observe(self, fault='', weight=10, baseline=False):
        self.rehearsal.fault = fault
        self.config_file.write_text(json.dumps(self.rehearsal.config))
        request = {'scope': SCOPE, 'candidate': revision('a'), 'previous': revision('b'),
                   'window_start': time.time() - 8, 'candidate_weight': weight}
        args = [sys.executable, str(SCRIPT), '--config', str(self.config_file)]
        if baseline:
            args += ['--baseline-seconds', '8']
        result = subprocess.run(args, input=json.dumps(request), text=True, capture_output=True, timeout=10)
        self.assertNotIn('rehearsal-private', result.stdout + result.stderr)
        self.assertNotIn(WALLET_FIXTURE_BALANCE, result.stdout + result.stderr)
        return result

    def test_counts_exact_scoped_scraped_deltas_for_both_releases(self):
        result = self.observe()
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data['scope'], SCOPE)
        self.assertEqual(data['candidate'], revision('a'))
        self.assertTrue(all(data['smoke'].values()))
        self.assertTrue(data['smoke']['dashboard'])
        self.assertTrue(data['smoke']['wallet'])
        self.assertEqual(data['api']['attempts'], 21 * data['api']['failures'])
        self.assertEqual(data['api']['p95_upper_seconds'], 0.25)
        self.assertIsNone(data['api']['p99_upper_seconds'])
        self.assertGreaterEqual(data['api']['failures'], 5)
        self.assertEqual(len(data['journeys']), 4)
        for counts in data['journeys'].values():
            self.assertEqual(counts, {'attempts': 2 * data['api']['failures'], 'failures': 0})
        previous = self.observe(baseline=True)
        self.assertEqual(previous.returncode, 0, previous.stderr)
        baseline = json.loads(previous.stdout)
        self.assertEqual(baseline['revision'], revision('b'))
        self.assertEqual(baseline['p95_upper_seconds'], 0.25)
        self.assertIsNone(baseline['p99_upper_seconds'])
        self.assertGreaterEqual(baseline['failures'], 5)
        self.assertEqual(set(baseline['journeys']), set(data['journeys']))

    def test_p99_uses_the_same_window_and_reports_unbounded_tail_as_unavailable(self):
        for fault, bound in (('p99-volume', 0.5), ('p99-unbounded', None)):
            for baseline in (False, True):
                with self.subTest(fault=fault, baseline=baseline):
                    result = self.observe(fault, baseline=baseline)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    data = json.loads(result.stdout)
                    api = data if baseline else data['api']
                    self.assertGreaterEqual(api['attempts'], 1000)
                    self.assertEqual(api['p95_upper_seconds'], 0.25)
                    self.assertEqual(api['p99_upper_seconds'], bound)

    def test_native_api_scrape_covers_both_metric_families_without_duplicate_targets(self):
        config = self.rehearsal.config
        for pool in ('candidate', 'previous'):
            config['targets'].pop(config[pool]['journey_job'])
            config[pool]['journey_job'] = config[pool]['api_job']
        result = self.observe()
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertGreater(data['api']['attempts'], 0)
        self.assertEqual(len(data['journeys']), 4)
        for value in data['journeys'].values():
            self.assertEqual(value, {'attempts': 2 * data['api']['failures'], 'failures': 0})
        for fault, expected in (
            ('api-restarted', 'unstable_node_process_start_time_seconds'),
            ('missing-solar', 'journey_counters_missing'),
        ):
            with self.subTest(fault=fault):
                failed = self.observe(fault)
                self.assertEqual(failed.returncode, 1)
                self.assertIn(expected, failed.stderr)

    def test_shared_job_is_only_valid_within_the_same_release_pool(self):
        config = self.rehearsal.config
        config['targets'].pop(config['previous']['journey_job'])
        config['previous']['journey_job'] = config['candidate']['api_job']
        result = self.observe()
        self.assertEqual(result.returncode, 1)
        self.assertIn('invalid_monitoring_targets', result.stderr)
        self.assertEqual(self.rehearsal.requests, [])

    def test_foreign_session_or_fixture_cannot_pass_smoke(self):
        for fault in ('foreign-profile', 'additional-profile', 'delegated-profile'):
            with self.subTest(fault=fault):
                result = self.observe(fault)
                self.assertEqual(result.returncode, 0, result.stderr)
                smoke = json.loads(result.stdout)['smoke']
                self.assertTrue(smoke.pop('health'))
                self.assertFalse(any(smoke.values()))
                paths = {path for _, path, _, _ in self.rehearsal.requests}
                self.assertNotIn('/api/dashboard/context', paths)
                self.assertFalse(any(path.startswith(tuple(SERVICES)) for path in paths))
        for fault in ('foreign-saving', 'foreign-owner-saving', 'missing-saving'):
            with self.subTest(fault=fault):
                result = self.observe(fault)
                self.assertEqual(result.returncode, 0, result.stderr)
                smoke = json.loads(result.stdout)['smoke']
                self.assertFalse(smoke.pop('saving'))
                self.assertTrue(all(smoke.values()))

    def test_dashboard_and_wallet_smoke_are_profile_scoped(self):
        result = self.observe('foreign-dashboard')
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertFalse(data['smoke']['dashboard'])
        self.assertFalse(data['smoke']['wallet'])
        self.assertFalse(any(path.startswith('/api/wallet/') for _, path, _, _ in self.rehearsal.requests))
        result = self.observe('invalid-wallet')
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertTrue(data['smoke']['dashboard'])
        self.assertFalse(data['smoke']['wallet'])

    def test_tail_latency_has_no_finite_p95_bound(self):
        result = self.observe('tail-latency')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(json.loads(result.stdout)['api']['p95_upper_seconds'])

    def test_session_is_never_forwarded_or_sent_to_public_probes(self):
        result = self.observe('redirect')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([row for row in self.rehearsal.requests if row[2]], [
            ('candidate', '/api/auth/user', 'barghsa_session=' + self.rehearsal.config['session_id'], None),
        ])

    def test_database_unavailability_stops_before_authenticated_smoke(self):
        result = self.observe('database-down')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(), 'observation_unavailable')
        self.assertEqual(self.rehearsal.requests, [
            ('candidate', '/release.json', None, None),
            ('candidate', '/api/health/live', None, None),
            ('candidate', '/api/health/ready', None, None),
        ])

    def test_requires_both_api_revisions_before_authenticated_smoke(self):
        for pool in ('candidate', 'previous'):
            for issue in ('missing', 'wrong'):
                fault = f'{pool}-api-revision-{issue}'
                with self.subTest(fault=fault):
                    result = self.observe(fault)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertFalse(any(json.loads(result.stdout)['smoke'].values()))
                    self.assertIn((pool, '/api/health/ready', None, None), self.rehearsal.requests)
                    self.assertFalse(any(cookie for _, _, cookie, _ in self.rehearsal.requests))
                    if pool == 'previous':
                        self.rehearsal.requests.clear()
                        baseline = self.observe(fault, baseline=True)
                        self.assertEqual(baseline.returncode, 1)
                        self.assertEqual(baseline.stderr.strip(), 'previous_release_unready')
                        self.assertEqual(baseline.stdout, '')
                        self.assertFalse(any(kind == 'monitoring' for kind, *_ in self.rehearsal.requests))
                    self.rehearsal.requests.clear()

    def test_missing_or_untrustworthy_measurements_fail_closed(self):
        for fault, reason in (
            ('mixed-release', 'monitoring_release_mismatch'),
            ('reset', 'counter_gap_or_reset'),
            ('missing-bucket', 'incomplete_http_latency_histogram'),
            ('wrong-total-bucket', 'incomplete_http_latency_histogram'),
            ('nonmonotonic-latency', 'nonmonotonic_http_latency_histogram'),
            ('missing-solar', 'journey_counters_missing'),
            ('scrape-down', 'incomplete_monitoring_coverage'),
            ('stale-security-rule', 'security_rule_unhealthy'),
            ('missing-auth-rule', 'security_rules_missing'),
            ('missing-previous-api-role', 'authentication_scrape_role_missing'),
        ):
            with self.subTest(fault=fault):
                result = self.observe(fault)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, '')
                self.assertEqual(result.stderr.strip(), reason)

    def test_preflight_observes_wallet_and_pending_alerts_without_traffic_volume(self):
        for fault, field, count in (('wallet-drift', 'critical_wallet_drift', 1),
                                    ('security-alert', 'security_alerts', 2),
                                    ('auth-alert', 'security_alerts', 1),
                                    ('foreign-auth-alert', 'security_alerts', 0)):
            with self.subTest(fault=fault):
                result = self.observe(fault, weight=0)
                self.assertEqual(result.returncode, 0, result.stderr)
                data = json.loads(result.stdout)
                self.assertEqual(data[field], count)
                self.assertIsNone(data['api'])
                self.assertIsNone(data['journeys'])

    def test_rejects_configuration_readable_by_other_users(self):
        self.config_file.chmod(0o644)
        result = self.observe()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr.strip(), 'unsafe_configuration_permissions')
        self.assertFalse(self.rehearsal.requests)
