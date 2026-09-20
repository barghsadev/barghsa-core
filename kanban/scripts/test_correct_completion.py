import contextlib
import fcntl
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from correct_completion import main
from loop_state import StateStore, completion_correction


class CompletionCorrectionTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.remote = self.root / "remote.git"
        subprocess.run(["git", "init", "--bare", str(self.remote)], check=True, capture_output=True)
        self.store = StateStore(self.root / "first", str(self.remote))
        self.initial = {"status": "blocked", "build_completed_tasks": ["a.md#T-1", "b.md#T-2"],
                        "task_events": [{"task_key": "a.md#T-1", "disposition": "merged"}],
                        "assignment": {"id": "preserve-me"}, "current_pr_number": 12,
                        "status_history": [{"status": "blocked"}]}
        self.store.save(self.initial, bootstrap=True)
        self.revision = self.store.revision
        self.review = {"expected_revision": self.revision, "task_key": "a.md#T-1",
                       "reason": "Only half the requirements were implemented",
                       "review_reference": "audit/reviewed-correction.md", "reviewed_by": "Test reviewer"}

    def test_correction_survives_restart_and_preserves_assignment_and_history(self):
        corrected = self.store.correct_completion(self.review)
        recovered = StateStore(self.root / "second", str(self.remote)).read()
        self.assertEqual(recovered, corrected)
        self.assertEqual(recovered["status"], "blocked")
        self.assertEqual(recovered["build_completed_tasks"], ["b.md#T-2"])
        for field in ("assignment", "current_pr_number", "status_history"):
            self.assertEqual(recovered[field], self.initial[field])
        self.assertEqual(recovered["task_events"][:-1], self.initial["task_events"])
        self.assertEqual(recovered["task_events"][-1]["correction"], self.review)
        self.assertEqual(recovered["task_events"][-1]["disposition"], "partial")
        self.assertEqual(self.initial["build_completed_tasks"], ["a.md#T-1", "b.md#T-2"])

    def test_ordinary_save_cannot_smuggle_a_correction(self):
        proposed = completion_correction(self.initial, self.revision, self.review)
        with self.assertRaisesRegex(ValueError, "completion removal"):
            self.store.save(proposed)

    def test_invalid_reviews_or_active_state_never_publish(self):
        for review in (None, {}, {**self.review, "extra": True},
                       *({**self.review, field: ""} for field in self.review),
                       {**self.review, "task_key": "missing.md#T-1"},
                       {**self.review, "expected_revision": "0" * 40}):
            with self.subTest(review=review), self.assertRaises(ValueError):
                self.store.correct_completion(review)
        for status in ("idle", "building", "in_review", "fixing", "approved", "complete"):
            with self.subTest(status=status), self.assertRaises(ValueError):
                completion_correction({**self.initial, "status": status}, self.revision, self.review)
        self.assertEqual(self.store.remote_revision(), self.revision)

    def test_stale_or_replayed_review_cannot_publish(self):
        stale = StateStore(self.root / "second", str(self.remote))
        stale.read()
        self.store.correct_completion(self.review)
        with self.assertRaisesRegex(RuntimeError, "advanced"):
            stale.correct_completion(self.review)
        with self.assertRaisesRegex(ValueError, "different state revision"):
            self.store.correct_completion(self.review)

    def test_failed_push_keeps_previous_completion(self):
        original = self.store.git
        def fail_push(*args, **kwargs):
            if args[0] == "push":
                raise RuntimeError("network unavailable")
            return original(*args, **kwargs)
        with mock.patch.object(self.store, "git", side_effect=fail_push):
            with self.assertRaisesRegex(RuntimeError, "network"):
                self.store.correct_completion(self.review)
        self.assertEqual(self.store.read(), self.initial)

    def test_cli_preview_apply_and_shared_lock(self):
        review = self.root / "review.json"
        review.write_text(json.dumps(self.review))
        lock = self.root / "lock"
        args = ["--state-dir", str(self.root / "cli"), "--remote", str(self.remote),
                "--review", str(review)]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(main(args, lock_file=lock), 0)
        self.assertFalse(json.loads(output.getvalue())["applied"])
        self.assertEqual(self.store.remote_revision(), self.revision)
        with lock.open("a+") as handle, contextlib.redirect_stderr(io.StringIO()):
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(main([*args, "--apply"], lock_file=lock), 1)
        self.assertEqual(self.store.remote_revision(), self.revision)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main([*args, "--apply"], lock_file=lock), 0)
        self.assertEqual(self.store.read()["build_completed_tasks"], ["b.md#T-2"])

    def test_cli_rejects_a_product_state_directory_before_reading_remote(self):
        checkout = Path(__file__).resolve().parents[2]
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(["--state-dir", str(checkout / "kanban"), "--remote", "unused",
                                   "--review", str(self.root / "missing")], lock_file=self.root / "lock"), 1)
