import copy
import unittest

from board import read, validate


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
