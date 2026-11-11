from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from urllib.parse import parse_qs, urlsplit


SCRIPT = Path(__file__).with_name('record-release-annotation.py')
SCOPE = {'environment': 'isolated-rehearsal', 'database': 'core'}
TOKEN = 'fixture-grafana-token-0123456789'


class ReleaseAnnotationTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
        self.version = json.loads(subprocess.check_output(['git', 'show', 'HEAD:package.json']))['version']
        self.when = int(time.time()) - 10
        self.requests, self.markers = [], []
        self.mode = 'normal'
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def send_json(self, value, status=200):
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(value).encode())

            def do_GET(self):
                path = urlsplit(self.path)
                fixture.requests.append(('GET', path.path, self.headers.get('Authorization')))
                if fixture.mode == 'redirect':
                    self.send_response(302)
                    self.send_header('Location', '/unexpected')
                    self.end_headers()
                    return
                tags = set(parse_qs(path.query).get('tags', []))
                self.send_json([row for row in fixture.markers if tags.issubset(row['tags'])])

            def do_POST(self):
                fixture.requests.append(('POST', self.path, self.headers.get('Authorization')))
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if fixture.mode != 'missing':
                    fixture.markers.append({**payload, 'id': len(fixture.markers) + 1,
                                            'dashboardUID': '', 'panelId': 0})
                self.send_json({'id': len(fixture.markers)}, 200 if fixture.mode == 'normal' else 502)

            def log_message(self, *_):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .05}, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.config_path = self.root / 'config.json'
        self.receipt_path = self.root / 'rollout.jsonl'
        self.config = {'origin': f'http://127.0.0.1:{self.server.server_port}', 'token': TOKEN,
                       'owner': 'Release lead', 'summary': 'Verified API & web update', 'scope': SCOPE}
        self.write_config()
        self.events = [
            {'event': 'plan', 'candidate': {'commit': self.commit}, 'scope': SCOPE},
            {'event': 'traffic_verified', 'weight': 100, 'recorded_at': self.when},
            {'event': 'observation', 'weight': 100, 'ready': True, 'recorded_at': self.when + 1},
            {'event': 'completed', 'weight': 100, 'recorded_at': self.when + 2},
        ]
        self.write_receipt()

    def write_config(self):
        self.config_path.write_text(json.dumps(self.config))
        self.config_path.chmod(0o600)

    def write_receipt(self, events=None):
        rows = self.events if events is None else events
        self.receipt_path.write_text(''.join(json.dumps(row) + '\n' for row in rows))
        self.receipt_path.chmod(0o600)

    def run_cli(self):
        result = subprocess.run([sys.executable, str(SCRIPT), '--config', str(self.config_path),
                                 '--receipt', str(self.receipt_path)], capture_output=True, text=True, timeout=8)
        self.assertNotIn(TOKEN, result.stdout + result.stderr)
        return result

    def assert_verified(self, result, annotation_id=1):
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt['status'], 'verified')
        self.assertEqual(receipt['annotation_id'], annotation_id)
        self.assertEqual(receipt['commit'], self.commit)
        self.assertEqual(receipt['version'], self.version)
        self.assertEqual(receipt['time_ms'], self.when * 1000)
        self.assertEqual(receipt['scope'], SCOPE)
        return receipt

    def test_complete_release_posts_once_and_reads_back_the_exact_marker(self):
        receipt = self.assert_verified(self.run_cli())
        self.assertEqual(self.requests, [(method, '/api/annotations', f'Bearer {TOKEN}')
                                         for method in ('GET', 'POST', 'GET')])
        marker, = self.markers
        self.assertEqual(set(marker['tags']), {'barghsa-release', 'environment:isolated-rehearsal',
                                                'database:core', 'release-id:' + receipt['release_id']})
        self.assertEqual(marker['time'], self.when * 1000)
        self.assertIn('Owner: Release lead', marker['text'])
        self.assertIn('Verified API &amp; web update', marker['text'])
        self.assertIn(f'/blob/{self.commit}/releases/{self.version}.md', marker['text'])
        self.assert_verified(self.run_cli())
        self.assertEqual(len(self.markers), 1)
        self.assertEqual([row[0] for row in self.requests].count('POST'), 1)

    def test_lost_response_is_reconciled_without_a_second_post(self):
        self.mode = 'response_lost'
        self.assert_verified(self.run_cli())
        self.assert_verified(self.run_cli())
        self.assertEqual([row[0] for row in self.requests].count('POST'), 1)

    def test_uncertain_delivery_is_held_and_state_is_private(self):
        self.mode = 'missing'
        for _ in range(2):
            result = self.run_cli()
            self.assertEqual(result.returncode, 1)
            self.assertIn('grafana_marker_delivery_unconfirmed', result.stderr)
        state, = self.root.glob('.grafana-release-*')
        self.assertEqual(state.stat().st_mode & 0o777, 0o600)
        self.assertEqual([row[0] for row in self.requests].count('POST'), 1)

    def test_bad_release_receipts_do_not_contact_grafana(self):
        for events in (self.events[:-1], [*self.events, None], [*self.events, {'event': 'halted'}],
                       [{**self.events[0], 'candidate': {'commit': 'f' * 40}}, *self.events[1:]],
                       [{**self.events[0], 'scope': {'environment': 'foreign', 'database': 'core'}}, *self.events[1:]],
                       [*self.events[:2], {**self.events[2], 'ready': False}, self.events[-1]]):
            with self.subTest(events=events):
                self.write_receipt(events)
                self.assertEqual(self.run_cli().returncode, 1)
        self.assertEqual(self.requests, [])

    def test_unsafe_origin_and_group_readable_credentials_are_refused(self):
        self.config_path.chmod(0o640)
        self.assertIn('unsafe_annotation_file', self.run_cli().stderr)
        self.config['origin'] = 'http://example.invalid'
        self.write_config()
        self.assertIn('grafana_origin_invalid', self.run_cli().stderr)
        self.assertEqual(self.requests, [])

    def test_redirect_does_not_forward_the_credential(self):
        self.mode = 'redirect'
        self.assertEqual(self.run_cli().returncode, 1)
        self.assertEqual(self.requests, [('GET', '/api/annotations', f'Bearer {TOKEN}')])


if __name__ == '__main__':
    unittest.main()
