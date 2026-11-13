import copy
from contextlib import redirect_stdout
from io import StringIO
import unittest
from unittest.mock import patch

from board import blocking_defects, main, read, render, validate
from test_definition_of_done import record


class BoardIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.board = copy.deepcopy(read())

    def rejects(self, pattern):
        with self.assertRaisesRegex(ValueError, pattern):
            validate(self.board)

    def test_reconciled_real_inventory(self):
        validate(self.board)

    def test_duplicate_qualified_key(self):
        self.board['tasks'].append(copy.deepcopy(self.board['tasks'][0]))
        self.rejects('Duplicate qualified')

    def test_original_task_cannot_disappear(self):
        self.board['tasks'].pop(0)
        self.rejects('inventory changed or lost')

    def test_edited_requirement_cannot_keep_old_spec_binding(self):
        self.board['tasks'][0]['requirement'] = 'A different requirement'
        self.rejects('Stale original task requirement')

    def test_done_requires_complete_evidence_and_no_remaining_work(self):
        task = next(t for t in self.board['tasks'] if t['status'] == 'done')
        task['remaining'] = ['An unmet acceptance criterion']
        self.rejects('still has remaining')
        task['remaining'] = []
        task['evidence']['current_acceptance'] = None
        self.rejects('lacks acceptance')

    def test_changed_source_invalidates_current_acceptance(self):
        task = next(t for t in self.board['tasks'] if t['status'] == 'done')
        task['evidence']['current_acceptance']['source_evidence'][0]['sha256'] = '0' * 64
        self.rejects('Done evidence changed')

    def test_missing_release_and_cycle_block_selection(self):
        self.board['tasks'][-1]['release'] = '9.9.9'
        self.rejects('Invalid task state or release')
        self.board = read()
        a, b = self.board['tasks'][-2:]
        a['depends_on'] = [b['key']]
        b['depends_on'] = [a['key']]
        self.rejects('dependency cycle')

    def test_release_dependencies_cannot_point_forward(self):
        self.board['releases'][0]['depends_on'] = ['1.0.0']
        self.rejects('Invalid release dependency')

    def test_candidate_rejects_open_critical_and_major_defects_outside_launch_scope(self):
        release = next(r for r in self.board['releases'] if r['version'] == '0.6.0')
        release.update(status='accepted', acceptance={'gates': {'fixture': 'verified'}})
        defect = next(t for t in self.board['tasks'] if t['release'] == '0.6.0' and t['status'] == 'verify')
        defect['launch_required'] = False
        for severity in ('P0', 'P1'):
            with self.subTest(severity=severity):
                defect['defect_severity'] = severity
                self.rejects(f'v0.6.0 has an open {severity} defect')

    def test_candidate_gate_preserves_severity_scope_and_resolution(self):
        release = next(r for r in self.board['releases'] if r['version'] == '0.5.1')
        release.update(status='accepted', acceptance={'gates': {'fixture': 'verified'}})
        open_minor = next(t for t in self.board['tasks'] if t['release'] == '0.5.0' and t['status'] == 'superseded')
        open_minor['status'] = 'verify'
        resolved = next(t for t in self.board['tasks'] if t['release'] == '0.5.0' and t['status'] == 'done')
        future = next(t for t in self.board['tasks'] if t['release'] == '0.9.0' and t['status'] != 'done')
        open_minor['defect_severity'] = 'P2'
        resolved['defect_severity'] = 'P1'
        future['defect_severity'] = 'P0'
        validate(self.board)
        self.assertIn(' (P2 defect)', render(self.board))
        self.assertEqual(blocking_defects(self.board['tasks'], {'0.5.0', '0.6.0', '0.9.0'}), [future])

    def test_candidate_rejects_required_work_in_current_and_earlier_releases(self):
        release = next(r for r in self.board['releases'] if r['version'] == '0.5.1')
        release.update(status='accepted', acceptance={'gates': {'fixture': 'verified'}})
        for version in ('0.5.0', '0.5.1'):
            with self.subTest(version=version):
                task = next(t for t in self.board['tasks'] if t['release'] == version
                            and t['launch_required'] and t['status'] == 'done')
                task['status'] = 'verify'
                self.rejects('v0.5.1 has 1 unresolved launch-required tasks')
                task['status'] = 'done'

    def test_candidate_rejects_an_expired_exception_in_scope(self):
        release = next(r for r in self.board['releases'] if r['version'] == '0.5.1')
        release.update(status='accepted', acceptance={'gates': {'fixture': 'verified'}})
        task = next(t for t in self.board['tasks'] if t['release'] == '0.3.0' and t['status'] == 'done')
        exception = record(task=task['key'], approved_at='2024-10-11T08:00:00Z',
                           expires_at='2024-10-12T08:00:00Z')
        self.board['dod_exceptions'] = [exception]
        self.rejects('v0.5.1 has an expired Definition of Done exception')
        exception.update(closed_at='2024-10-13T08:00:00Z', closure_ref='verified-review-receipt')
        validate(self.board)

    def test_ready_reopens_expired_approval_at_the_scope_boundary(self):
        task = next(t for t in self.board['tasks'] if t['release'] == '0.3.0' and t['status'] == 'done')
        exception = record(task=task['key'], approved_at='2024-10-11T08:00:00Z',
                           expires_at='2024-10-12T08:00:00Z')
        self.board['dod_exceptions'] = [exception]

        def readiness(version):
            output = StringIO()
            with patch('board.read', return_value=self.board), patch(
                'sys.argv', ['board.py', 'ready', '--release', version]
            ), redirect_stdout(output):
                status = main()
            return status, output.getvalue()

        earlier_status, earlier_output = readiness('0.2.0')
        self.assertEqual(earlier_status, 0)
        self.assertNotIn('Reopened Definition of Done exception', earlier_output)
        status, output = readiness('0.3.0')
        self.assertEqual(status, 1)
        self.assertIn('0 unresolved launch-required tasks', output)
        self.assertIn(f"Reopened Definition of Done exception: {task['key']}", output)
        exception.update(closed_at='2024-10-13T08:00:00Z', closure_ref='verified-review-receipt')
        status, output = readiness('0.3.0')
        self.assertEqual(status, 0)
        self.assertNotIn('Reopened Definition of Done exception', output)

    def test_rejects_invalid_defect_severity(self):
        self.board['tasks'][0]['defect_severity'] = 'critical'
        self.rejects('Invalid defect severity')

    def test_released_milestone_requires_external_receipts(self):
        release = self.board['releases'][0]
        release['status'] = 'released'
        release['acceptance'] = None
        for field in ('published_commit', 'staging_receipt', 'telegram_receipt'):
            release[field] = None
        self.rejects('requires recorded gate evidence')
        release['acceptance'] = {'review':'synthetic accepted candidate'}
        self.rejects('requires push, staging and Telegram receipts')

    def test_launch_scope_cannot_accidentally_drop_services(self):
        self.board['launch_scope'] = ['electricity']
        self.rejects('retain all four services')

    def test_superseded_and_blocked_need_explicit_disposition(self):
        task = next(t for t in self.board['tasks'] if t['status'] == 'superseded')
        task.pop('disposition')
        self.rejects('explicit non-launch disposition')
        self.board = read()
        task = next(t for t in self.board['tasks'] if t['status'] == 'blocked')
        task.pop('blocker')
        self.rejects('has no blocker')


if __name__ == '__main__':
    unittest.main()
