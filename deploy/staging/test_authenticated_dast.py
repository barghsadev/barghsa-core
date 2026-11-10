import importlib.util
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs
from uuid import uuid4


spec = importlib.util.spec_from_file_location(
    'authenticated_dast', Path(__file__).with_name('authenticated-dast.py')
)
dast = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = dast
spec.loader.exec_module(dast)


class AuthenticatedDastTests(unittest.TestCase):
    def setUp(self):
        self.fixture = dast.Fixture(
            str(uuid4()), str(uuid4()), 'barghsa-dast-abcd1234@example.test', str(uuid4())
        )
        self.zap = Mock()
        self.zap.call.side_effect = [
            {'version': '2.17.0'}, {'scanners': [{'enabled': 'true'}]}, {'recordsToScan': '0'},
            {'alerts': [{'pluginId': '10015', 'risk': 'Low', 'evidence': self.fixture.session,
                         'url': 'https://stg.barghsa.com/private-data'}]},
        ]
        self.responses = [
            (401, {}),
            (200, {'userId': self.fixture.user_id, 'username': self.fixture.username,
                   'isStaff': False, 'operatingContext': 'customer'}),
            (200, {'profiles': [{'id': self.fixture.profile_id}]}),
            (200, {'orders': []}),
            (404, {'error': {'code': 'NOT_FOUND:RESOURCE'}}),
            (200, {}), (200, {}), (200, {}),
        ]

    def test_scans_authenticated_customer_and_publishes_only_safe_receipts(self):
        self.zap.get.side_effect = self.responses
        result = dast.scan(self.zap, self.fixture)
        self.assertEqual(len(result['probes']), 8)
        self.assertEqual(result['findings'], [{'rule': '10015', 'risk': 'Low', 'count': 1}])
        calls = self.zap.get.call_args_list
        self.assertEqual(calls[0].args, ('/api/auth/user', None))
        self.assertTrue(all(call.args[1] == self.fixture for call in calls[1:]))
        self.assertEqual([call.args[0].split('?')[0] for call in calls[-3:]], [
            '/api/saving/orders', '/api/solar/requests', '/api/consultations/requests',
        ])
        self.assertNotIn(self.fixture.session, json.dumps(result))
        self.assertNotIn(self.fixture.profile_id, json.dumps(result))
        self.assertNotIn('private-data', json.dumps(result))

    def test_rejects_staff_or_a_scan_that_never_authenticated(self):
        for identity in ({'isStaff': True}, {'userId': str(uuid4())}):
            with self.subTest(identity=identity):
                zap = Mock()
                zap.call.side_effect = [{'version': '2.17.0'}, {'scanners': [{'enabled': True}]}]
                zap.get.side_effect = [self.responses[0], (200, {**self.responses[1][1], **identity})]
                with self.assertRaisesRegex(dast.ScanError, 'authorized synthetic customer'):
                    dast.scan(zap, self.fixture)
                self.assertEqual(zap.get.call_count, 2)

    def test_requires_enabled_scanner_and_expected_unauthenticated_denial(self):
        self.zap.call.side_effect = [{'version': '2.17.0'}, {'scanners': [{'enabled': False}]}]
        with self.assertRaisesRegex(dast.ScanError, 'no enabled passive scan rules'):
            dast.scan(self.zap, self.fixture)
        self.zap.get.assert_not_called()
        self.zap.call.side_effect = [{'version': '2.17.0'}, {'scanners': [{'enabled': True}]}]
        self.zap.get.return_value = (200, {})
        with self.assertRaisesRegex(dast.ScanError, 'anonymous_session returned HTTP 200'):
            dast.scan(self.zap, self.fixture)

    def test_stops_if_the_fixture_can_read_an_additional_profile(self):
        self.responses[2][1]['profiles'].append({'id': str(uuid4())})
        self.zap.get.side_effect = self.responses
        with self.assertRaisesRegex(dast.ScanError, 'exactly the dedicated synthetic profile'):
            dast.scan(self.zap, self.fixture)
        self.assertEqual(self.zap.get.call_count, 3)

    def test_control_post_keeps_cookie_out_of_url_and_disables_redirects(self):
        zap = dast.Zap(10080, 'ephemeral-test-key')
        with patch.object(dast, 'json_response', return_value={'sendRequest': [{
            'responseHeader': 'HTTP/1.1 200 OK\r\n', 'responseBody': '{}',
        }]}) as call:
            self.assertEqual(zap.get('/api/profiles', self.fixture), (200, {}))
        connection, method, path, body, headers = call.call_args.args
        self.assertEqual((connection.host, method, path), ('127.0.0.1', 'POST',
                                                          'http://zap/JSON/core/action/sendRequest/'))
        self.assertEqual(headers['Host'], 'zap')
        self.assertEqual(headers['X-ZAP-API-Key'], 'ephemeral-test-key')
        self.assertNotIn(self.fixture.session, path)
        parsed = parse_qs(body)
        self.assertEqual(parsed['followRedirects'], ['false'])
        self.assertIn(f'Cookie: barghsa_session={self.fixture.session}\r\n', parsed['request'][0])
        self.assertTrue(parsed['request'][0].startswith('GET https://stg.barghsa.com/api/profiles '))

    def test_fixture_rejects_world_readable_files_symlinks_and_real_account_names(self):
        with TemporaryDirectory() as temp:
            fixture = Path(temp) / 'fixture.json'
            fixture.write_text(json.dumps(self.fixture.__dict__))
            fixture.chmod(0o600)
            self.assertEqual(dast.load_fixture(fixture), self.fixture)
            symlink = Path(temp) / 'fixture-link.json'
            symlink.symlink_to(fixture)
            with self.assertRaises(OSError):
                dast.load_fixture(symlink)
            fixture.chmod(0o644)
            with self.assertRaisesRegex(dast.ScanError, 'private file'):
                dast.load_fixture(fixture)
            fixture.chmod(0o600)
            fixture.write_text(json.dumps({**self.fixture.__dict__, 'username': 'staff@example.com'}))
            with self.assertRaisesRegex(dast.ScanError, 'dedicated synthetic customer'):
                dast.load_fixture(fixture)


if __name__ == '__main__':
    unittest.main()
