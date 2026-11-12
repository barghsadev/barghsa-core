from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import ci_preflight_receipt as evidence


SHA = 'a' * 40
BASE = 'b' * 40
REPO = 'barghsadev/barghsa-core'
NOW = datetime(2026, 11, 12, 8, 30, tzinfo=timezone.utc)
RUN = {
    'head_sha': SHA, 'head_repository': {'full_name': REPO},
    'path': evidence.WORKFLOW, 'event': 'push', 'head_branch': 'codex/preflight/current',
    'status': 'completed', 'conclusion': 'success', 'id': 100, 'run_attempt': 2,
    'check_suite_id': 200,
}
CHECK = {
    'head_sha': SHA, 'name': evidence.CHECK, 'app': {'id': 15368}, 'check_suite': {'id': 200},
    'status': 'completed', 'conclusion': 'success', 'completed_at': '2026-11-12T08:29:00Z',
}
RECEIPT = evidence.proof(SHA, BASE, 100, 2)


class PreflightReceiptTests(unittest.TestCase):
    def evaluate(self, *, run=RUN, checks=None, receipt=RECEIPT):
        checks = [CHECK] if checks is None else checks
        with patch.object(evidence, 'api', side_effect=[{'workflow_runs': [run]}, {'check_runs': checks}]), \
                patch.object(evidence, 'read_receipt', return_value=receipt) as read:
            result = evidence.find_preflight(REPO, SHA, BASE, NOW)
        return result, read

    def test_exact_recent_preflight_and_attempt_receipt_can_be_reused(self):
        result, read = self.evaluate()
        self.assertEqual(result, 100)
        read.assert_called_once_with(REPO, 100, 2)

    def test_only_the_same_completed_push_workflow_on_a_preflight_branch_is_eligible(self):
        for change in (
            {'head_sha': 'c' * 40}, {'head_repository': {'full_name': 'fork/barghsa-core'}},
            {'event': 'workflow_dispatch'}, {'head_branch': 'main'},
            {'path': '.github/workflows/other.yml'}, {'conclusion': 'failure'},
            {'status': 'in_progress'},
        ):
            with self.subTest(change=change):
                result, read = self.evaluate(run={**RUN, **change})
                self.assertIsNone(result)
                read.assert_not_called()

    def test_required_check_must_be_fresh_successful_and_from_the_exact_suite_and_app(self):
        for change in (
            {'head_sha': 'c' * 40}, {'app': {'id': 234}}, {'check_suite': {'id': 300}},
            {'name': 'Run tests'}, {'status': 'in_progress'}, {'conclusion': 'failure'},
            {'completed_at': '2026-11-12T07:29:00Z'},
            {'completed_at': '2026-11-12T08:31:00Z'},
        ):
            with self.subTest(change=change):
                result, read = self.evaluate(checks=[{**CHECK, **change}])
                self.assertIsNone(result)
                read.assert_not_called()
        self.assertIsNone(self.evaluate(checks=[])[0])
        self.assertIsNone(self.evaluate(checks=[CHECK, CHECK])[0])

    def test_receipt_must_match_head_comparison_base_mode_run_and_attempt(self):
        for change in (
            {'sha': 'c' * 40}, {'base': 'c' * 40}, {'kind': 'full-coverage'},
            {'run_id': 101}, {'attempt': 1},
        ):
            with self.subTest(change=change):
                self.assertIsNone(self.evaluate(receipt={**RECEIPT, **change})[0])
        self.assertIsNone(self.evaluate(receipt=None)[0])

    def test_artifact_download_error_uses_normal_tests(self):
        with patch.object(evidence, 'api', side_effect=[{'workflow_runs': [RUN]}, {'check_runs': [CHECK]}]), \
                patch.object(evidence, 'read_receipt', side_effect=subprocess.TimeoutExpired('gh', 15)):
            self.assertIsNone(evidence.find_preflight(REPO, SHA, BASE, NOW))

    def test_full_pr_and_manual_runs_never_reuse_affected_tests(self):
        environment = {'GITHUB_SHA': SHA, 'PUSH_TEST_BASE': BASE, 'GITHUB_REF': 'refs/heads/main',
                       'FULL_CI': 'false', 'GITHUB_EVENT_NAME': 'push'}
        for change in ({'FULL_CI': 'true'}, {'GITHUB_EVENT_NAME': 'pull_request'},
                       {'GITHUB_EVENT_NAME': 'workflow_dispatch'}, {'PUSH_TEST_BASE': '0' * 40}):
            with self.subTest(change=change), patch.dict(os.environ, {**environment, **change}, clear=True), \
                    patch.object(evidence, 'find_preflight') as find:
                evidence.main('reuse')
                find.assert_not_called()

    def test_outputs_are_written_only_for_an_eligible_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'output'
            summary = root / 'summary'
            environment = {
                'GITHUB_SHA': SHA, 'PUSH_TEST_BASE': BASE, 'GITHUB_REF': 'refs/heads/codex/preflight/current',
                'GITHUB_RUN_ID': '100', 'GITHUB_RUN_ATTEMPT': '2', 'RUNNER_TEMP': directory,
                'GITHUB_REPOSITORY': REPO, 'GITHUB_OUTPUT': str(output), 'GITHUB_STEP_SUMMARY': str(summary),
                'GITHUB_EVENT_NAME': 'push', 'FULL_CI': 'false',
            }
            with patch.dict(os.environ, environment, clear=True):
                evidence.main('write')
            self.assertEqual(json.loads((root / evidence.RECEIPT).read_text()), RECEIPT)
            self.assertEqual(output.read_text(), 'saved=true\n')
            output.unlink()
            environment['GITHUB_REF'] = 'refs/heads/main'
            with patch.dict(os.environ, environment, clear=True):
                with patch.object(evidence, 'find_preflight', return_value=None):
                    evidence.main('reuse')
                    self.assertFalse(output.exists())
                with patch.object(evidence, 'find_preflight', return_value=100):
                    evidence.main('reuse')
            self.assertEqual(output.read_text(), 'reused=true\n')
            self.assertIn(f'https://github.com/{REPO}/actions/runs/100', summary.read_text())


if __name__ == '__main__':
    unittest.main()
