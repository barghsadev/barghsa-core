import json
from pathlib import Path
import tempfile
import unittest

from current_pr_reviews import report


class ReplacementDispositionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'audit/evidence').mkdir(parents=True)
        self.key = '01-platform-infrastructure.md#T-01.02.02'
        self.task = {'task_key': self.key, 'merged_prs': []}
        self.acceptance = {'task_key': self.key, 'status': 'acceptance_verified'}
        self.disposition = {
            'pr': 47, 'status': 'closed', 'reason': 'Workaround replaced by strict declarations',
            'evidence': 'audit/evidence/step-reviews.json#replacement',
            'superseded_by_task_keys': [self.key],
        }
        self.deferrals = []

    def render(self):
        files = {
            'merged-pr-evidence.json': [{'number': 47, 'title': 'Historical workaround', 'html_url': 'https://example.test/pr/47'}],
            'task-review.json': {'tasks': [self.task]},
            'acceptance-closure.json': {'reviewed_tasks': [self.acceptance]},
            'pr-deferrals.json': self.deferrals,
            'evidence/step-reviews.json': {'steps': [{'id': 'replacement', 'pr_dispositions': [self.disposition]}]},
        }
        for name, data in files.items():
            (self.root / 'audit' / name).write_text(json.dumps(data))
        return report(self.root)

    def test_explicit_verified_replacement_retains_unmapped_history(self):
        text = self.render()
        self.assertIn('1 have no current task mapping', text)
        self.assertIn('1 closed', text)
        self.assertIn('Superseded by verified: ' + self.key, text)
        self.assertEqual(self.task['merged_prs'], [])

    def test_unmapped_work_cannot_close_without_replacement_proof(self):
        for value in [[], 'a-task', ['missing'], [self.key, self.key]]:
            with self.subTest(value=value):
                self.disposition['superseded_by_task_keys'] = value
                with self.assertRaises(ValueError):
                    self.render()

    def test_partial_replacement_cannot_close(self):
        self.acceptance['status'] = 'partial'
        with self.assertRaises(ValueError):
            self.render()

    def test_replacement_cannot_bypass_unresolved_mapped_task(self):
        self.task['merged_prs'] = [47]
        self.acceptance['status'] = 'partial'
        with self.assertRaises(ValueError):
            self.render()

    def test_replacement_cannot_bypass_historical_deferrals(self):
        self.deferrals = [{'pr': 47, 'historical_deferrals': ['Unavailable check']}]
        with self.assertRaisesRegex(ValueError, 'undispositioned historical deferrals'):
            self.render()

    def test_replacement_requires_review_reason_and_evidence(self):
        for key in ['reason', 'evidence']:
            with self.subTest(key=key):
                saved = self.disposition.pop(key)
                with self.assertRaises(ValueError):
                    self.render()
                self.disposition[key] = saved


if __name__ == '__main__':
    unittest.main()
