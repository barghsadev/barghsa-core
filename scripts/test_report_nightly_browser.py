import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


spec = importlib.util.spec_from_file_location(
    "nightly", Path(__file__).with_name("report-nightly-browser.py")
)
nightly = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nightly)
IDENTITY = {"commit": "a" * 40, "run_id": 1, "run_attempt": 1}


class NightlyBrowserReportTests(unittest.TestCase):
    def setUp(self):
        scratch = TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)

    def write_shard(self, project, shard, attempt=1, **updates):
        path = self.root / f"browser-outcome-{project}-{shard}-attempt-{attempt}" / "browser-outcomes.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        result = dict.fromkeys(nightly.COUNTS, 0)
        result.update(schema_version=1, status="passed", expected=2)
        result.update({**IDENTITY, "run_attempt": attempt, "project": project, "shard": shard})
        result.update(updates)
        path.write_text(json.dumps(result))
        return path

    def test_all_expected_shards_must_pass(self):
        for project in nightly.PROJECTS:
            for shard in nightly.SHARDS:
                self.write_shard(project, shard)
        passed = nightly.summarize_shards(self.root, IDENTITY)
        self.assertEqual(passed["status"], "passed")
        self.assertEqual(passed["reported_shards"], 40)
        self.assertEqual(passed["counts"]["expected"], 80)
        self.write_shard("chromium", 1, flaky=1)
        failed = nightly.summarize_shards(self.root, IDENTITY)
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["counts"]["flaky"], 1)
        self.assertEqual(failed["failed_shards"], ["browser-outcome-chromium-1"])
        self.write_shard("chromium", 1, attempt=2)
        retry = nightly.summarize_shards(self.root, {**IDENTITY, "run_attempt": 2})
        self.assertEqual(retry["status"], "incomplete")
        self.assertEqual(retry["reported_shards"], 1)
        self.assertEqual(retry["counts"]["expected"], 2)
        self.assertEqual(retry["counts"]["flaky"], 0)
        for project in nightly.PROJECTS:
            for shard in nightly.SHARDS:
                self.write_shard(project, shard, attempt=2)
        full_retry = nightly.summarize_shards(self.root, {**IDENTITY, "run_attempt": 2})
        self.assertEqual(full_retry["status"], "passed")
        self.assertEqual(full_retry["reported_shards"], 40)

    def test_missing_and_invalid_results_do_not_become_passes(self):
        self.write_shard("chromium", 1, status="failed", flaky=2)
        self.write_shard("webkit", 1, flaky=None)
        summary = nightly.summarize_shards(self.root, IDENTITY)
        self.assertEqual(summary["status"], "incomplete")
        self.assertEqual(summary["reported_shards"], 1)
        self.assertEqual(summary["counts"]["flaky"], 2)
        self.assertIn("browser-outcome-webkit-1", summary["missing_or_invalid_shards"])

    def test_wrong_shard_or_workflow_receipts_are_incomplete_even_with_pass_counts(self):
        for key, value in (("commit", "b" * 40), ("run_id", 2), ("run_attempt", 2),
                           ("project", "webkit"), ("shard", 2), ("shard", True)):
            with self.subTest(key=key, value=value):
                path = self.write_shard("chromium", 1)
                receipt = json.loads(path.read_text())
                receipt[key] = value
                path.write_text(json.dumps(receipt))
                summary = nightly.summarize_shards(self.root, IDENTITY)
                self.assertEqual(summary["status"], "incomplete")
                self.assertEqual(summary["reported_shards"], 0)
                self.assertIn("browser-outcome-chromium-1", summary["missing_or_invalid_shards"])

    def test_history_distinguishes_reported_results_from_unknown_flakes(self):
        self.write_shard("chromium", 1, status="failed", flaky=3)
        receipt = self.root / "1" / "nightly-browser-summary.json"
        receipt.parent.mkdir()
        receipt.write_text(json.dumps(nightly.summarize_shards(self.root, IDENTITY)))
        (receipt.parent / 'nightly-quarantine.json').write_text(json.dumps({
            'schema_version': 1, 'status': 'blocked', 'active_quarantine_count': 2,
        }))
        history = nightly.history_lines(
            [
                {"databaseId": 1, "conclusion": "failure", "attempt": 1, "sha": IDENTITY["commit"]},
                {"databaseId": 2, "conclusion": "cancelled"},
            ],
            self.root,
        )
        self.assertIn("0 of 2 scheduled runs passed.", history)
        self.assertIn("| 1 | failure | 1/40 | 3 | 2 |", history)
        self.assertIn("| 2 | cancelled | Unavailable | Unknown | Unknown |", history)
        self.assertEqual(nightly.history_lines(None, self.root), ["Scheduled run history unavailable."])
        newer = nightly.history_lines(
            [{"databaseId": 1, "conclusion": "success", "attempt": 2, "sha": IDENTITY["commit"]}],
            self.root,
        )
        self.assertIn("| 1 | success | Unavailable | Unknown | Unknown |", newer)

    def test_requires_exact_workflow_identity(self):
        env = {"GITHUB_SHA": IDENTITY["commit"], "GITHUB_RUN_ID": "1", "GITHUB_RUN_ATTEMPT": "1"}
        self.assertEqual(nightly.run_identity(env), IDENTITY)
        for key, value in (("GITHUB_SHA", "short"), ("GITHUB_RUN_ID", ""), ("GITHUB_RUN_ATTEMPT", "0")):
            with self.subTest(key=key), self.assertRaises(ValueError):
                nightly.run_identity({**env, key: value})

    def test_writes_the_same_message_when_the_matrix_is_incomplete(self):
        self.write_shard("chromium", 1)
        report = self.root / "report.json"
        message = self.root / "report.md"
        summary = self.root / "job-summary.md"
        result = subprocess.run(
            [
                sys.executable, nightly.__file__, "--outcomes", str(self.root),
                "--history", str(self.root), "--report", str(report), "--message", str(message),
            ],
            env={**os.environ, "GITHUB_STEP_SUMMARY": str(summary), "GITHUB_SHA": IDENTITY["commit"],
                 "GITHUB_RUN_ID": "1", "GITHUB_RUN_ATTEMPT": "1"},
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(report.read_text())["status"], "incomplete")
        self.assertEqual(json.loads(report.read_text())["run_attempt"], 1)
        self.assertEqual(json.loads(report.read_text())["summary_sha256"],
                         hashlib.sha256(message.read_bytes()).hexdigest())
        self.assertEqual(message.read_text(), result.stdout)
        self.assertEqual(summary.read_text(), result.stdout)
        self.assertIn("Current result is **incomplete**. 1 of 40 shards reported.", result.stdout)
