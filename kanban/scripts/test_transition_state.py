"""Obsolete builder commands must never edit the historical state snapshot."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class RetiredTransitionTests(unittest.TestCase):
    def test_every_legacy_command_refuses_without_writing_state(self):
        script = Path(__file__).with_name("transition_state.py")
        commands = [
            [], ["building", "a.md#T-1", "T-1", "a.md", "feature"],
            ["in_review", "https://example.invalid/pull/1"], ["fixing"],
            ["blocked", "reason"], ["merged", "feature"], ["unknown"],
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "kanban/loop-state.json"
            path.parent.mkdir()
            original = json.dumps({"status": "building", "status_history": [],
                                   "current_task_key": "a.md#T-1", "build_completed_tasks": []})
            for command in commands:
                with self.subTest(command=command):
                    path.write_text(original)
                    result = subprocess.run([sys.executable, str(script), *command],
                                            cwd=directory, capture_output=True, text=True)
                    self.assertEqual(path.read_text(), original)
                    self.assertEqual(result.returncode, 2)
                    self.assertIn("retired", result.stderr)

    def test_missing_snapshot_is_not_created(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("transition_state.py")), "merged"],
                cwd=directory, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertFalse((Path(directory) / "kanban").exists())
