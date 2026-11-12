from contextlib import redirect_stdout
from datetime import datetime, timezone
from email.message import Message
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

from release_evidence import NoRedirect, ReleaseEvidenceError


SPEC = importlib.util.spec_from_file_location('sentry_deploy', Path(__file__).with_name('record-sentry-deploy.py'))
sentry = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sentry)
TOKEN = 'fixture-release-token-0123456789'
ORIGIN = 'https://us.sentry.io'
SCOPE = {'environment': 'production', 'database': 'core'}


class SentryDeployTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.config_path, self.receipt_path = self.root / 'sentry.json', self.root / 'rollout.jsonl'
        self.commit, self.version = sentry.checked_checkout()
        self.when = int(time.time()) - 10
        self.config = {
            'origin': ORIGIN, 'organization': 'barghsa', 'token': TOKEN, 'projects': ['web', 'api'],
            'scope': SCOPE,
        }
        self.events = [
            {'event': 'plan', 'candidate': {'commit': self.commit}, 'scope': SCOPE},
            {'event': 'traffic_verified', 'weight': 100, 'recorded_at': self.when},
            {'event': 'observation', 'weight': 100, 'ready': True, 'recorded_at': self.when + 1},
            {'event': 'completed', 'weight': 100, 'recorded_at': self.when + 2},
        ]
        self.write_inputs()
        self.calls, self.deploys = [], []
        self.projects_with_commit = {'web', 'api'}
        self.failure = None
        self.posted = []
        opener = patch.object(sentry, 'build_opener', side_effect=self.opener)
        opener.start()
        self.addCleanup(opener.stop)

    def write_inputs(self):
        self.config_path.write_text(json.dumps(self.config))
        self.config_path.chmod(0o600)
        self.receipt_path.write_text(''.join(json.dumps(row) + '\n' for row in self.events))
        self.receipt_path.chmod(0o600)

    def opener(self, proxy, redirects):
        self.assertEqual(proxy.proxies, {})
        self.assertIsInstance(redirects, NoRedirect)
        return self

    def open(self, request, timeout):
        self.assertEqual(timeout, 5)
        uri = urlsplit(request.full_url)
        self.assertEqual(f'{uri.scheme}://{uri.netloc}', ORIGIN)
        self.assertEqual(request.get_header('Authorization'), 'Bearer ' + TOKEN)
        method = request.get_method()
        cursor = parse_qs(uri.query).get('cursor', [])
        self.calls.append((method, uri.path, cursor))
        link = None
        if uri.path.endswith('/commits/'):
            self.assertEqual(method, 'GET')
            project = uri.path.split('/')[5]
            self.assertEqual(uri.path, f'/api/0/projects/barghsa/{project}/releases/{self.commit}/commits/')
            rows = [{'id': self.commit, 'repository': {'name': 'other/repository'}}]
            if project in self.projects_with_commit:
                if not cursor:
                    # A provider pagination URL cannot change the credential destination.
                    link = '<https://elsewhere.example/page?cursor=0%3A20%3A0>; results="true"; rel="next"'
                else:
                    self.assertEqual(cursor, ['0:20:0'])
                    rows = [{'id': self.commit, 'repository': {'name': sentry.REPOSITORY}}]
        else:
            self.assertEqual(uri.path, f'/api/0/organizations/barghsa/releases/{self.commit}/deploys/')
            if method == 'POST':
                self.assertEqual(request.get_header('Content-type'), 'application/json')
                payload = json.loads(request.data)
                self.posted.append(payload)
                if self.failure != 'missing':
                    marker = {key: value for key, value in payload.items() if key != 'projects'}
                    self.deploys.append({**marker, 'id': str(len(self.deploys) + 1)})
                if self.failure:
                    raise HTTPError(request.full_url, 502, 'fixture response lost', {}, None)
                rows = self.deploys[-1]
            else:
                rows = self.deploys
        response = io.BytesIO(json.dumps(rows).encode())
        response.headers = Message()
        response.headers['Content-Type'] = 'application/json'
        if link:
            response.headers['Link'] = link
        return response

    def record(self):
        return sentry.record_deploy(self.config_path, self.receipt_path)

    def test_completed_production_rollout_reads_back_one_marker_for_the_exact_projects(self):
        result = self.record()
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(result['deploy_id'], '1')
        self.assertEqual(result['commit'], self.commit)
        self.assertEqual(result['version'], self.version)
        self.assertEqual(result['scope'], SCOPE)
        self.assertEqual(result['projects'], ['api', 'web'])
        marker, = self.posted
        self.assertEqual(marker['projects'], ['api', 'web'])
        self.assertEqual(marker['environment'], 'production')
        self.assertEqual(sentry.deployment_time(marker['dateStarted']), datetime.fromtimestamp(self.when, timezone.utc))
        self.assertEqual(sentry.deployment_time(marker['dateFinished']), datetime.fromtimestamp(self.when + 2, timezone.utc))
        self.assertIn(f'/blob/{self.commit}/releases/{self.version}.md', marker['url'])
        self.assertEqual(self.record(), result)
        self.assertEqual(len(self.posted), 1)
        self.assertNotIn(TOKEN, json.dumps(result))

    def test_lost_response_is_read_back_without_a_duplicate(self):
        self.failure = 'lost'
        self.assertEqual(self.record()['deploy_id'], '1')
        self.assertEqual(self.record()['deploy_id'], '1')
        self.assertEqual(len(self.posted), 1)

    def test_uncertain_delivery_remains_held(self):
        self.failure = 'missing'
        for _ in range(2):
            with self.assertRaisesRegex(ReleaseEvidenceError, 'sentry_marker_delivery_unconfirmed'):
                self.record()
        state, = self.root.glob('.sentry-release-*')
        self.assertEqual(state.stat().st_mode & 0o777, 0o600)
        self.assertEqual(len(self.posted), 1)

    def test_read_only_mode_refuses_an_unassociated_project_and_never_posts(self):
        self.projects_with_commit.remove('api')
        with self.assertRaisesRegex(ReleaseEvidenceError, 'sentry_release_commit_unverified'):
            self.record()
        self.assertFalse(self.posted)
        self.projects_with_commit.add('api')
        output = io.StringIO()
        args = ['record-sentry-deploy.py', '--config', str(self.config_path), '--verify-release']
        with patch.object(sys, 'argv', args), redirect_stdout(output):
            self.assertEqual(sentry.main(), 0)
        self.assertEqual(json.loads(output.getvalue())['status'], 'release_commit_verified')
        self.assertFalse(self.posted)
        self.assertTrue(all(path.endswith('/commits/') for _, path, _ in self.calls))

    def test_an_older_rollout_cannot_replace_the_current_sentry_deployment(self):
        self.deploys.append({
            'name': 'Other completed rollout', 'environment': 'production',
            'dateFinished': datetime.fromtimestamp(self.when + 5, timezone.utc).isoformat(),
        })
        with self.assertRaisesRegex(ReleaseEvidenceError, 'sentry_marker_superseded'):
            self.record()
        self.assertFalse(self.posted)

    def test_a_later_rollout_of_the_same_commit_gets_a_distinct_marker(self):
        initial_events = self.events
        first = self.record()
        self.events = [{**event, 'recorded_at': event['recorded_at'] + 4}
                       if 'recorded_at' in event else event for event in self.events]
        self.write_inputs()
        second = self.record()
        self.assertNotEqual(first['release_id'], second['release_id'])
        self.assertEqual(second['deploy_id'], '2')
        self.deploys.pop(0)  # Sentry exposes the latest deploy for the project and environment.
        self.events = initial_events
        self.write_inputs()
        with self.assertRaisesRegex(ReleaseEvidenceError, 'sentry_marker_superseded'):
            self.record()
        self.assertEqual(len(self.posted), 2)

    def test_rejects_untrusted_origin_and_incomplete_rollout_before_network_use(self):
        self.config['origin'] = 'https://us.sentry.io.evil.example'
        self.write_inputs()
        with self.assertRaisesRegex(ReleaseEvidenceError, 'sentry_origin_invalid'):
            self.record()
        self.config['origin'] = ORIGIN
        self.events.pop()
        self.write_inputs()
        with self.assertRaisesRegex(ReleaseEvidenceError, 'rollout_not_completed'):
            self.record()
        self.assertEqual(self.calls, [])

    def test_rejects_invalid_pagination_and_mismatched_marker_readback(self):
        with self.assertRaisesRegex(ReleaseEvidenceError, 'sentry_pagination_invalid'):
            sentry.next_cursor('<https://sentry.io/page>; rel="next"; results="true"')
        self.record()
        self.deploys[0]['url'] = 'https://unrelated.example/'
        with self.assertRaisesRegex(ReleaseEvidenceError, 'sentry_marker_conflict'):
            self.record()
        self.assertEqual(len(self.posted), 1)
