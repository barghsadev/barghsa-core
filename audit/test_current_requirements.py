import json
import unittest

from current_requirements import ROOT, build_register, requirement_record


class CurrentRequirementTests(unittest.TestCase):
    def record(self, fname, task_id):
        return requirement_record({"key": f"{fname}#{task_id}", "fname": fname, "id": task_id})

    def test_fourth_level_story_does_not_inherit_first_story_of_epic(self):
        record = self.record("01-platform-infrastructure.md", "T-02.02.01")
        self.assertTrue(record["story_context"].startswith("#### S-02.02:"))
        self.assertIn("Half-open ranges", record["story_context"])
        self.assertNotIn("S-02.01", record["story_context"])
        self.assertNotIn("T-02.02.02", record["requirement_extract"])

    def test_final_task_does_not_capture_next_fourth_level_story(self):
        record = self.record("01-platform-infrastructure.md", "T-02.02.04")
        self.assertIn("001-data-types-and-conventions", record["requirement_extract"])
        self.assertNotIn("S-02.03", record["requirement_extract"])

    def test_same_unqualified_id_remains_bound_to_its_own_epic(self):
        database = self.record("01-platform-infrastructure.md", "T-02.02.01")
        session = self.record("02-auth-users-admin.md", "T-02.02.01")
        self.assertNotEqual(database["context_sha256"], session["context_sha256"])
        self.assertIn("Session creation", session["requirement_extract"])
        self.assertNotIn("Drizzle", session["requirement_extract"])

    def test_multiline_table_task_retains_details_without_siblings(self):
        record = self.record("03-core-business.md", "T-03.01.02.01")
        self.assertIn("thermal_electricity", record["requirement_extract"])
        self.assertIn("energy_saving_electricity", record["requirement_extract"])
        self.assertNotIn("T-03.01.02.02", record["requirement_extract"])

    def test_all_original_keys_and_order_are_retained_without_acceptance_claims(self):
        baseline = json.loads((ROOT / "audit/task-review.json").read_text())
        register = build_register()
        self.assertEqual(len(register["tasks"]), 322)
        self.assertEqual([row["task_key"] for row in register["tasks"]],
                         [row["task_key"] for row in baseline["tasks"]])
        for row in register["tasks"]:
            self.assertNotIn("status", row)
            self.assertNotIn("merged_prs", row)

    def test_escaping_or_mismatched_identity_is_rejected(self):
        for task in ({"fname": "../other.md", "id": "T-01.01.01", "key": "../other.md#T-01.01.01"},
                     {"fname": "01-platform-infrastructure.md", "id": "T-02.02.01", "key": "wrong"}):
            with self.assertRaises(ValueError):
                requirement_record(task)


if __name__ == "__main__":
    unittest.main()
