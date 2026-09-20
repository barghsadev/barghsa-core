import json
import copy
import hashlib
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

    def protocol(self):
        source = self.root / 'loop.py'
        source.write_text('verified protocol implementation\n')
        self.disposition.pop('superseded_by_task_keys', None)
        self.disposition['protocol_review'] = {
            'requirements': ['Bind review to the advertised immutable commit'],
            'validation': ['Local Git integration passed at the recorded revision'],
            'source_evidence': [{'path': 'loop.py', 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()}],
        }

    def test_protocol_closure_preserves_unmapped_task_population(self):
        self.protocol()
        text = self.render()
        self.assertIn('1 closed', text)
        self.assertIn('1 have no current task mapping', text)
        self.assertIn('Protocol requirements reviewed separately', text)
        self.assertEqual(self.task['merged_prs'], [])

    def test_protocol_closure_requires_current_complete_evidence(self):
        self.protocol()
        original = copy.deepcopy(self.disposition)
        for field in ('requirements', 'validation', 'source_evidence'):
            for invalid in (None, [], '', [{}]):
                with self.subTest(field=field, invalid=invalid):
                    self.disposition = copy.deepcopy(original)
                    self.disposition['protocol_review'][field] = invalid
                    with self.assertRaises(ValueError):
                        self.render()
        self.disposition = original
        (self.root / 'loop.py').write_text('changed implementation\n')
        with self.assertRaises(ValueError):
            self.render()

    def test_protocol_cannot_bypass_task_or_deferral_requirements(self):
        self.protocol()
        self.task['merged_prs'] = [47]
        self.acceptance['status'] = 'partial'
        with self.assertRaises(ValueError):
            self.render()
        self.task['merged_prs'] = []
        self.deferrals = [{'pr': 47, 'historical_deferrals': ['Unverified external execution']}]
        with self.assertRaisesRegex(ValueError, 'undispositioned historical deferrals'):
            self.render()


if __name__ == '__main__':
    unittest.main()
