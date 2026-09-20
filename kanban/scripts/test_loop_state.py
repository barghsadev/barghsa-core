import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from loop_state import StateStore, atomic_json


class DurableStateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.remote = self.root / "remote.git"
        subprocess.run(["git", "init", "--bare", str(self.remote)], check=True, capture_output=True)
        self.store = StateStore(self.root / "first", str(self.remote))
        self.initial = {"status": "idle", "build_completed_tasks": ["a.md#T-1"],
                        "task_events": [{"task_key": "a.md#T-1", "disposition": "merged"}]}

    def test_restart_recovers_remote_state_without_product_checkout(self):
        self.store.save(self.initial, bootstrap=True)
        recovered = StateStore(self.root / "second", str(self.remote)).read()
        self.assertEqual(recovered, self.initial)
        # Only the dedicated state branch exists in the bare remote.
        refs = self.store.git("ls-remote", "--heads", str(self.remote))
        self.assertEqual(refs.split()[1], "refs/heads/kanban-state")

    def test_stale_supervisor_cannot_erase_new_completion(self):
        self.store.save(self.initial, bootstrap=True)
        stale = StateStore(self.root / "second", str(self.remote))
        stale.read()
        updated = json.loads(json.dumps(self.initial))
        updated["build_completed_tasks"].append("b.md#T-1")
        updated["task_events"].append({"task_key": "b.md#T-1", "disposition": "merged"})
        self.store.save(updated)
        with self.assertRaisesRegex(RuntimeError, "advanced"):
            stale.save(self.initial)
        self.assertEqual(stale.read(), updated)

    def test_completion_and_event_history_cannot_be_deleted(self):
        self.store.save(self.initial, bootstrap=True)
        for mutation in ({"build_completed_tasks": []}, {"task_events": []},
                         {"task_events": [{"task_key": "wrong", "disposition": "merged"}]}):
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                self.store.save({**self.initial, **mutation})

    def test_crash_after_push_recovers_remote_assignment(self):
        self.store.save(self.initial, bootstrap=True)
        updated = {**self.initial, "status": "building", "assignment": {"id": "attempt-one"}}
        with mock.patch("loop_state.atomic_json", side_effect=OSError("disk unavailable")):
            with self.assertRaises(OSError):
                self.store.save(updated)
        self.assertEqual(StateStore(self.root / "second", str(self.remote)).read(), updated)

    def test_failed_push_does_not_publish_local_success(self):
        self.store.save(self.initial, bootstrap=True)
        old_git = self.store.git
        def fail_push(*args, **kwargs):
            if args[0] == "push":
                raise RuntimeError("network unavailable")
            return old_git(*args, **kwargs)
        with mock.patch.object(self.store, "git", side_effect=fail_push):
            with self.assertRaisesRegex(RuntimeError, "network"):
                self.store.save({**self.initial, "status": "building"})
        self.assertEqual(json.loads((self.root / "first/state.json").read_text()), self.initial)

    def test_atomic_write_failure_preserves_previous_json(self):
        path = self.root / "state.json"
        atomic_json(path, self.initial)
        with mock.patch("loop_state.os.replace", side_effect=OSError("interrupted")):
            with self.assertRaises(OSError):
                atomic_json(path, {"status": "building"})
        self.assertEqual(json.loads(path.read_text()), self.initial)
        self.assertEqual(list(self.root.glob("tmp*")), [])

    def test_missing_state_blocks_instead_of_importing_stale_checkout(self):
        with self.assertRaisesRegex(RuntimeError, "not initialized"):
            self.store.read()
        with self.assertRaisesRegex(RuntimeError, "before saving"):
            self.store.save(self.initial)

    def test_product_branches_are_rejected(self):
        for ref in ("refs/heads/main", "refs/heads/codex/fixes", "HEAD"):
            with self.assertRaises(ValueError):
                StateStore(self.root / "bad", str(self.remote), ref)
