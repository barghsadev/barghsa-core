import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


spec = importlib.util.spec_from_file_location(
    "nightly", Path(__file__).with_name("report-nightly-browser.py")
)
nightly = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nightly)


class NightlyBrowserReportTests(unittest.TestCase):
    def setUp(self):
        scratch = TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)

    def write_shard(self, project, shard, **updates):
        path = self.root / f"browser-outcome-{project}-{shard}" / "browser-outcomes.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        result = dict.fromkeys(nightly.COUNTS, 0)
        result.update(schema_version=1, status="passed", expected=2)
        result.update(updates)
        path.write_text(json.dumps(result))
        return path

    def test_all_expected_shards_must_pass(self):
        for project in nightly.PROJECTS:
            for shard in nightly.SHARDS:
                self.write_shard(project, shard)
        passed = nightly.summarize_shards(self.root)
        self.assertEqual(passed["status"], "passed")
        self.assertEqual(passed["reported_shards"], 40)
        self.assertEqual(passed["counts"]["expected"], 80)
        self.write_shard("chromium", 1, flaky=1)
        failed = nightly.summarize_shards(self.root)
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["counts"]["flaky"], 1)
        self.assertEqual(failed["failed_shards"], ["browser-outcome-chromium-1"])

    def test_missing_and_invalid_results_do_not_become_passes(self):
        self.write_shard("chromium", 1, status="failed", flaky=2)
        self.write_shard("webkit", 1, flaky=None)
        summary = nightly.summarize_shards(self.root)
        self.assertEqual(summary["status"], "incomplete")
        self.assertEqual(summary["reported_shards"], 1)
        self.assertEqual(summary["counts"]["flaky"], 2)
        self.assertIn("browser-outcome-webkit-1", summary["missing_or_invalid_shards"])

    def test_history_distinguishes_reported_results_from_unknown_flakes(self):
        self.write_shard("chromium", 1, status="failed", flaky=3)
        receipt = self.root / "1" / "nightly-browser-summary.json"
        receipt.parent.mkdir()
        receipt.write_text(json.dumps(nightly.summarize_shards(self.root)))
        (receipt.parent / 'nightly-quarantine.json').write_text(json.dumps({
            'schema_version': 1, 'status': 'blocked', 'active_quarantine_count': 2,
        }))
        history = nightly.history_lines(
            [
                {"databaseId": 1, "conclusion": "failure"},
                {"databaseId": 2, "conclusion": "cancelled"},
            ],
            self.root,
        )
        self.assertIn("0 of 2 scheduled runs passed.", history)
        self.assertIn("| 1 | failure | 1/40 | 3 | 2 |", history)
        self.assertIn("| 2 | cancelled | Unavailable | Unknown | Unknown |", history)
        self.assertEqual(nightly.history_lines(None, self.root), ["Scheduled run history unavailable."])
