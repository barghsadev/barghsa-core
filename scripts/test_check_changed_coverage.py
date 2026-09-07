import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("check-changed-coverage.py")
spec = importlib.util.spec_from_file_location("changed_coverage", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def coverage(line_hits=(1, 0), branch_hits=(1, 0)):
    location = lambda line: {"start": {"line": line}, "end": {"line": line}}
    return {"statementMap": {str(i): location(i + 1) for i in range(len(line_hits))},
            "s": {str(i): hit for i, hit in enumerate(line_hits)},
            "branchMap": {"0": {"loc": location(1), "locations": [location(1) for _ in branch_hits]}},
            "b": {"0": list(branch_hits)}}


class CoverageTests(unittest.TestCase):
    def test_normal_changes_and_critical_whole_file(self):
        normal = module.metrics(coverage(), {1}, False)
        critical = module.metrics(coverage(), {1}, True)
        self.assertEqual(normal, {"lines": 1, "covered_lines": 1, "branches": 2, "covered_branches": 1})
        self.assertEqual(critical["lines"], 2)
        self.assertEqual(critical["covered_lines"], 1)

    def test_shared_statement_lines_take_max_hits(self):
        document = coverage()
        document["statementMap"]["1"] = document["statementMap"]["0"]
        result = module.metrics(document, {1}, False)
        self.assertEqual(result["lines"], 1)
        self.assertEqual(result["covered_lines"], 1)

    def test_multiline_branch_covers_changed_interior(self):
        document = coverage()
        document["branchMap"]["0"]["loc"]["end"]["line"] = 8
        self.assertEqual(module.metrics(document, {5}, False)["branches"], 2)

    def test_minified_reverse_span_preserves_uncovered_branch_counts(self):
        document = coverage()
        document["branchMap"]["0"]["loc"] = {"start": {"line": 5}, "end": {"line": 3}}
        result = module.metrics(document, {4}, False)
        self.assertEqual(result["branches"], 2)
        self.assertEqual(result["covered_branches"], 1)
        document["branchMap"]["0"]["loc"]["end"]["line"] = 0
        with self.assertRaises(ValueError):
            module.metrics(document, {4}, False)

    def test_corrupt_counters_fail_closed(self):
        for hit in (-1, True, None, "1", float("nan"), float("inf")):
            with self.subTest(hit=hit), self.assertRaises(ValueError):
                module.metrics(coverage((hit,)), {1}, False)
        document = coverage()
        document["s"].pop("0")
        with self.assertRaises(ValueError):
            module.metrics(document, {1}, False)
        document = coverage()
        document["b"]["0"] = [1]
        with self.assertRaises(ValueError):
            module.metrics(document, {1}, False)

    def test_source_scope_and_critical_domains(self):
        for path in ("apps/api/src/auth/login.ts", "apps/web/src/routes/_auth/login.tsx", "packages/db/src/schema/wallet-payments.ts", "apps/api/src/invoice/invoice-state-machine.ts", "apps/api/src/admin/admin.service.ts"):
            with self.subTest(path=path):
                self.assertTrue(module.eligible(path))
                self.assertTrue(module.CRITICAL.search(path))
        for path in ("apps/web/e2e/login.spec.ts", "apps/api/src/auth/auth.test.ts", "packages/db/src/test/setup.ts", "apps/api/src/generated/client.ts", "apps/web/src/env.d.ts", "scripts/check.mjs"):
            with self.subTest(path=path):
                self.assertFalse(module.eligible(path))

    def test_missing_reports_and_files_cannot_pass(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = "apps/api/src/auth/login.ts"
            self.assertEqual(module.evaluate(root, {path: {1}})["status"], "failed")
            report = root / "apps/api/coverage/coverage-final.json"
            report.parent.mkdir(parents=True)
            for content in ("{}", "[]", "broken"):
                report.write_text(content)
                self.assertEqual(module.evaluate(root, {path: {1}})["status"], "failed")

    def test_threshold_boundaries_and_package_isolation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def put(path, data):
                package = "/".join(path.split("/")[:2])
                report = root / package / "coverage/coverage-final.json"
                report.parent.mkdir(parents=True, exist_ok=True)
                report.write_text(json.dumps({str(root / path): data}))
            general = "apps/web/src/widget.tsx"
            critical = "apps/api/src/auth/login.ts"
            put(general, coverage([1] * 8 + [0] * 2, [1] * 3 + [0]))
            put(critical, coverage([1] * 9 + [0], [1] * 17 + [0] * 3))
            changed = {general: set(range(1, 11)), critical: {1}}
            self.assertEqual(module.evaluate(root, changed)["status"], "passed")
            put(critical, coverage([1] * 8 + [0] * 2, [1] * 17 + [0] * 3))
            self.assertEqual(module.evaluate(root, changed)["status"], "failed")
            put(critical, coverage([1] * 9 + [0], [1] * 16 + [0] * 4))
            self.assertEqual(module.evaluate(root, changed)["status"], "failed")

    def test_real_git_diff_additions_deletions_and_worktree_isolation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(["git", "-C", str(root), *args], text=True, stderr=subprocess.DEVNULL).strip()
            git("init")
            git("config", "user.name", "Coverage test")
            git("config", "user.email", "coverage@example.invalid")
            path = root / "apps/web/src/widget.ts"
            path.parent.mkdir(parents=True)
            path.write_text("one\ntwo\nthree\n")
            git("add", ".")
            git("commit", "-m", "baseline")
            base = git("rev-parse", "HEAD")
            path.write_text("one\nchanged\nthree\nnew\n")
            git("add", ".")
            git("commit", "-m", "change")
            path.write_text("uncommitted\n")
            ancestor, changed = module.changes(root, base)
            self.assertEqual(ancestor, base)
            self.assertEqual(changed, {"apps/web/src/widget.ts": {2, 4}})
            path.write_text("one\nthree\n")
            git("add", ".")
            git("commit", "-m", "remove only")
            self.assertEqual(module.changes(root, base)[1], {})


if __name__ == "__main__":
    unittest.main()
