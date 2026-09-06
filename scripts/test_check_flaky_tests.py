import copy
from datetime import date
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("check-flaky-tests.py")
spec = importlib.util.spec_from_file_location("flaky_check", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
TODAY = date(2026, 9, 7)
RECORD = {
    "testPath": "apps/web/e2e/payment.spec.ts",
    "testName": "completes payment",
    "owner": "@barghsadev/core",
    "issueUrl": "https://github.com/barghsadev/barghsa-core/issues/42",
    "quarantineDate": "2026-08-24",
    "expiryDate": "2026-09-23",
    "severity": "critical",
    "reason": "Shared database race",
}


class QuarantineTests(unittest.TestCase):
    def evaluate(self, *records):
        return module.evaluate({"version": 1, "quarantined": list(records)}, TODAY)

    def test_empty_does_not_claim_runtime_measurement(self):
        report = self.evaluate()
        self.assertEqual(report["active_quarantine_count"], 0)
        self.assertIsNone(report["observed_runtime_flake_count"])

    def test_valid_record_is_reported_without_blocking(self):
        report = self.evaluate(RECORD)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["active_quarantine_count"], 1)

    def test_expiry_is_inclusive_utc_day(self):
        record = dict(RECORD, expiryDate=TODAY.isoformat())
        self.assertEqual(self.evaluate(record)["active_quarantine_count"], 1)

    def test_expired_critical_blocks_but_noncritical_is_reported(self):
        record = dict(RECORD, expiryDate="2026-09-06")
        self.assertEqual(self.evaluate(record)["status"], "blocked")
        record["severity"] = "non-critical"
        report = self.evaluate(record)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["expired_quarantine_count"], 1)
        self.assertEqual(report["active_quarantine_count"], 0)

    def test_invalid_fields_fail_closed(self):
        changes = {
            "owner": ["", "someone", "@team\n::notice::spoof"],
            "issueUrl": ["https://example.com/issues/1", "https://github.com/a/b/issues/0"],
            "testPath": ["../secret", "/tmp/test", "a/../test", "./test", "a\\test"],
            "testName": [None, " "],
            "reason": [""],
            "severity": ["unknown"],
            "quarantineDate": ["2026-09-08", "2026-02-30", "20260901"],
            "expiryDate": ["2026-09-24", "2026-08-24", "2026-08-23"],
        }
        for key, values in changes.items():
            for value in values:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    self.evaluate(dict(RECORD, **{key: value}))

    def test_duplicate_and_missing_fields_fail(self):
        with self.assertRaises(ValueError):
            self.evaluate(RECORD, copy.deepcopy(RECORD))
        for key in RECORD:
            record = dict(RECORD)
            del record[key]
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.evaluate(record)

    def test_bad_registry_schema(self):
        for registry in (None, [], {}, {"version": True, "quarantined": []}, {"version": 1, "quarantined": {}}, {"version": 1, "quarantined": [None]}):
            with self.subTest(registry=registry), self.assertRaises(ValueError):
                module.evaluate(registry, TODAY)

    def test_cli_missing_malformed_and_valid_registry_overwrite_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            registry = root / "registry.json"
            report = root / "report.json"
            for content, code in ((None, 1), ("broken", 1), ('{"version":1,"quarantined":[]}', 0)):
                with self.subTest(content=content):
                    if content is not None:
                        registry.write_text(content)
                    report.write_text('{"status":"stale-success"}')
                    output = root / "output"
                    summary = root / "summary"
                    output.write_text("")
                    result = subprocess.run(["bash", str(SCRIPT.with_suffix(".sh")), "--registry", str(registry), "--report", str(report)], env={**os.environ, "GITHUB_OUTPUT": str(output), "GITHUB_STEP_SUMMARY": str(summary)}, capture_output=True, text=True)
                    self.assertEqual(result.returncode, code, result.stderr)
                    parsed = json.loads(report.read_text())
                    self.assertEqual(parsed["status"], "passed" if code == 0 else "invalid")
                    self.assertNotIn("flaky_count=0", output.read_text())
                    self.assertIn("Runtime flakes: not measured" if code == 0 else "Counts unknown", summary.read_text())


if __name__ == "__main__":
    unittest.main()
