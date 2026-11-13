import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

spec = importlib.util.spec_from_file_location("browser_results", Path(__file__).with_name("check-browser-results.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BrowserResultTests(unittest.TestCase):
    def test_pass_and_failures(self):
        stats = {"expected": 1, "unexpected": 0, "flaky": 0, "skipped": 0}
        self.assertEqual(module.summarize({"stats": stats, "errors": []})["status"], "passed")
        for patch in ({"flaky": 1}, {"unexpected": 1}, {"expected": 0, "skipped": 1}):
            with self.subTest(patch=patch):
                self.assertEqual(module.summarize({"stats": {**stats, **patch}, "errors": []})["status"], "failed")
        self.assertEqual(module.summarize({"stats": stats, "errors": [{}]})["status"], "failed")

    def test_unknown_is_not_zero(self):
        for document in (None, {}, {"stats": {}}, {"stats": {"expected": True, "unexpected": 0, "flaky": 0, "skipped": 0}, "errors": []}):
            with self.subTest(document=document), self.assertRaises(ValueError):
                module.summarize(document)

    def test_nightly_receipt_binds_actual_configuration_to_the_workflow_attempt(self):
        document = {
            "stats": {"expected": 1, "unexpected": 0, "flaky": 0, "skipped": 0},
            "errors": [],
            "config": {"filteredProjects": [{"name": "firefox"}], "shard": {"current": 5, "total": 8}},
        }
        env = {**os.environ, "GITHUB_SHA": "a" * 40, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2"}
        with TemporaryDirectory() as directory:
            input_path = Path(directory) / "playwright.json"
            output_path = Path(directory) / "outcomes.json"
            input_path.write_text(json.dumps(document))
            command = [sys.executable, module.__file__, "--input", str(input_path), "--report", str(output_path)]
            for project, shard, valid in (("firefox", "5", True), ("chromium", "5", False), ("firefox", "6", False)):
                with self.subTest(project=project, shard=shard):
                    result = subprocess.run([*command, "--project", project, "--shard", shard],
                                            env=env, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0 if valid else 1, result.stdout + result.stderr)
                    receipt = json.loads(output_path.read_text())
                    if valid:
                        self.assertEqual(receipt, {**module.summarize(document), "commit": "a" * 40,
                                                   "run_id": 123, "run_attempt": 2, "project": "firefox", "shard": 5})
                    else:
                        self.assertEqual(receipt["status"], "invalid")
            result = subprocess.run(command, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(json.loads(output_path.read_text()), module.summarize(document))


if __name__ == "__main__":
    unittest.main()
