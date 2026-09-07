import copy
import json
import unittest

from current_skipped_tasks import ROOT, reconcile


class SkippedTaskTests(unittest.TestCase):
    def setUp(self):
        self.skips = json.loads((ROOT / "audit/skipped-tasks.json").read_text())
        self.closure = json.loads((ROOT / "audit/acceptance-closure.json").read_text())

    def test_preserves_all_skips_and_their_provenance_without_mutating_inputs(self):
        before = copy.deepcopy(self.skips)
        rows = reconcile(self.skips, self.closure)
        self.assertEqual(self.skips, before)
        self.assertEqual(len(rows), 58)
        self.assertEqual([r["task_key"] for r in rows], [r["task_key"] for r in before])
        for row, original in zip(rows, before):
            self.assertEqual(row["direct_merged_prs"], original["direct_merged_prs"])
            self.assertEqual(row["historical_skip_commit"], original["skip_commit"])

    def test_only_explicit_verified_evidence_prevents_rebuilding(self):
        rows = reconcile(self.skips, self.closure)
        verified = [r for r in rows if r["acceptance_status"] == "acceptance_verified"]
        self.assertEqual({r["task_key"] for r in verified}, {
            "01-platform-infrastructure.md#T-06.02.03",
            "01-platform-infrastructure.md#T-06.02.05",
            "01-platform-infrastructure.md#T-06.03.04",
        })
        self.assertTrue(all("do not rebuild" in r["next_action"] for r in verified))
        self.assertEqual(sum(r["acceptance_status"] == "acceptance_pending" for r in rows), 55)

    def test_historical_partial_or_merged_claim_is_not_acceptance(self):
        rows = reconcile(self.skips, self.closure)
        for row in rows:
            if row["reviewed_sha"] is None:
                self.assertEqual(row["acceptance_status"], "acceptance_pending")
                self.assertIn("only unmet remainder", row["next_action"])

    def test_duplicate_and_missing_identities_fail_closed(self):
        with self.assertRaises(ValueError):
            reconcile(self.skips + [self.skips[0]], self.closure)
        self.closure["pending_task_keys"].remove(self.skips[0]["task_key"])
        with self.assertRaises(ValueError):
            reconcile(self.skips, self.closure)

    def test_review_and_pending_population_cannot_overlap(self):
        self.closure["pending_task_keys"].append(self.closure["reviewed_tasks"][0]["task_key"])
        with self.assertRaises(ValueError):
            reconcile(self.skips, self.closure)


if __name__ == "__main__":
    unittest.main()
