import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("check_sast", Path(__file__).with_name("check-sast.py"))
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class SastReportTests(unittest.TestCase):
    def test_omits_source_and_credentials_from_findings_and_parser_errors(self):
        raw = {
            "paths": {"scanned": ["apps/api/src/example.ts"]},
            "results": [{
                "check_id": "literal-credential-assignment",
                "path": "apps/api/src/example.ts",
                "start": {"line": 7},
                "extra": {
                    "severity": "ERROR", "lines": "private-source-value",
                    "message": "private-source-value", "metavars": {"value": "private-source-value"},
                },
            }],
            "errors": [{"code": 3, "path": "example.ts", "level": "warn", "message": "private-source-value"}],
        }
        report = scanner.safe_report(raw, 1)
        self.assertNotIn("private-source-value", json.dumps(report))
        self.assertEqual(report["findings"][0]["line"], 7)
        self.assertEqual(report["errors"][0]["code"], 3)

    def test_empty_scan_and_parser_warnings_are_not_success(self):
        for raw in [{}, {"paths": {"scanned": ["example.ts"]}, "errors": [{"code": 3}]}]:
            self.assertEqual(scanner.report_exit_code(scanner.safe_report(raw, 0)), 1)

    def test_findings_block_even_if_process_reports_success(self):
        report = {"scanned_files": ["example.ts"], "findings": [{"rule": "example"}], "errors": [], "exit_code": 0}
        self.assertEqual(scanner.report_exit_code(report), 1)

    def test_retains_process_failures_and_allows_clean_nonempty_scan(self):
        raw = {"paths": {"scanned": ["example.ts"]}}
        self.assertEqual(scanner.report_exit_code(scanner.safe_report(raw, 7)), 7)
        self.assertEqual(scanner.report_exit_code(scanner.safe_report(raw, 0)), 0)


if __name__ == "__main__":
    unittest.main()
