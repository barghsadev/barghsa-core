import importlib.util
from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()
