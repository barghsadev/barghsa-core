import json
import unittest

from build_backlog import ROOT, QUEUE_PATH
from reconcile_loop import reconciled_state


class ReconciliationTests(unittest.TestCase):
    def test_all_audited_claims_get_provenance_without_false_acceptance(self):
        load = lambda path: json.loads(path.read_text())
        state = reconciled_state(load(ROOT / "audit/merged-task-register.json"),
                                 load(ROOT / "audit/task-review.json"), load(ROOT / "kanban/loop-state.json"),
                                 load(QUEUE_PATH))
        self.assertEqual(state["status"], "blocked")
        self.assertEqual(len(state["build_completed_tasks"]), 263)
        self.assertEqual(len(set(state["build_completed_tasks"])), 263)
        self.assertEqual(len({event["task_key"] for event in state["task_events"]}), 324)
        self.assertFalse(any(event["disposition"] == "acceptance_verified" for event in state["task_events"]))
        self.assertEqual(sum(event["disposition"] == "deferred" for event in state["task_events"]), 57)
        self.assertEqual(sum(event["disposition"] == "retired" for event in state["task_events"]), 2)
