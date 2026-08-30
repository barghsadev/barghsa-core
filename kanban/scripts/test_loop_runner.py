import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

MODULE_PATH = Path(__file__).with_name("loop-runner.py")
spec = importlib.util.spec_from_file_location("loop_runner", MODULE_PATH)
loop_runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loop_runner)


class LoopRunnerProtocolTests(unittest.TestCase):
    def setUp(self):
        self.task = {
            "key": "04-invoices-wallet-contracts.md#T-04.1.02.08",
            "fname": "04-invoices-wallet-contracts.md",
            "id": "T-04.1.02.08",
            "title": "Invoice calculation snapshot",
            "complexity": "L",
        }
        self.state = {
            "status": "in_review",
            "current_task_key": self.task["key"],
            "current_task_id": self.task["id"],
            "current_task_file": self.task["fname"],
            "current_branch": "feat/e04-t-04-1-02-08--invoice-calculation-snapshot",
            "current_pr_url": "https://github.com/barghsadev/barghsa-core/pull/231",
            "current_pr_number": 231,
            "current_head_sha": "a" * 40,
            "validation_results": [
                {"command": "pnpm test", "status": "passed", "summary": "all pass"}
            ],
        }
        self.pr = {
            "number": 231,
            "title": "feat(invoices): persist reproducible calculation snapshots",
            "url": self.state["current_pr_url"],
            "state": "OPEN",
            "isDraft": False,
            "mergeable": "MERGEABLE",
            "headRefName": self.state["current_branch"],
            "headRefOid": self.state["current_head_sha"],
            "baseRefName": "main",
            "baseRefOid": "d" * 40,
            "body": (
                "Implements the invoice calculation snapshot.\n\n"
                "## What\n- Stores reproducible inputs and totals.\n\n"
                "## Acceptance criteria\n- [x] Snapshot persisted.\n\n"
                "## Validation\n- `pnpm test` — pass\n\n"
                "## Risks / limitations\n- None"
            ),
            "files": ["apps/api/src/invoice/snapshot.ts"],
            "statusCheckRollup": [],
        }

    def successful_check(self):
        return {"name": "CI", "conclusion": "SUCCESS", "status": "COMPLETED"}

    def test_fix_attempt_limit_allows_ten_rounds(self):
        self.assertEqual(loop_runner.MAX_FIX_ATTEMPTS, 10)

    def test_task_section_extracts_table_row_tasks(self):
        section = loop_runner.task_section(self.task)

        self.assertIn("T-04.1.02.08", section)
        self.assertIn("invoice_calculation_snapshot", section)
        self.assertIn("| S |", section)

    def test_review_schema_types_const_and_enum_fields_for_codex(self):
        schema = json.loads(loop_runner.REVIEW_SCHEMA.read_text())
        properties = schema["properties"]

        self.assertEqual(properties["schema_version"]["type"], "integer")
        self.assertEqual(properties["decision"]["type"], "string")
        self.assertEqual(
            properties["issues"]["items"]["properties"]["severity"]["type"],
            "string",
        )

    def test_materialize_review_commits_accepts_stale_pr_base_after_main_advances(self):
        pr = {
            "number": 233,
            "baseRefOid": "a" * 40,
            "headRefOid": "b" * 40,
        }

        def fake_run(command, **_kwargs):
            if command[:2] == ["git", "rev-parse"]:
                return SimpleNamespace(stdout="b" * 40 + "\n")
            return SimpleNamespace(stdout="")

        with mock.patch.object(loop_runner, "run", side_effect=fake_run) as run_mock:
            loop_runner.materialize_review_commits(pr)

        commands = [call.args[0] for call in run_mock.call_args_list]
        self.assertIn(["git", "cat-file", "-e", "a" * 40 + "^{commit}"], commands)
        self.assertNotIn(["git", "rev-parse", "origin/main^{commit}"], commands)

    def test_state_dispatch_keeps_review_and_merge_on_separate_ticks(self):
        self.assertEqual(loop_runner.action_for_status("idle"), "cursor_build")
        self.assertEqual(loop_runner.action_for_status("building"), "cursor_build")
        self.assertEqual(loop_runner.action_for_status("fixing"), "cursor_fix")
        self.assertEqual(loop_runner.action_for_status("in_review"), "codex_review")
        self.assertEqual(loop_runner.action_for_status("approved"), "merge")
        self.assertEqual(loop_runner.action_for_status("blocked"), "noop")

    def test_cursor_prompt_makes_cursor_own_commit_push_pr_and_state(self):
        prompt = loop_runner.build_cursor_prompt(
            task=self.task,
            task_section="Task details",
            state=self.state,
            mode="build",
        )
        for required in (
            "git commit",
            "git push",
            "gh pr create",
            "meaningful",
            '"status": "in_review"',
            '"current_head_sha"',
            '"review": null',
            "invalidates the prior review",
            "kanban/loop-state.json",
            "Do not return success",
        ):
            self.assertIn(required, prompt)
        self.assertIn("do not stage or commit kanban/loop-state.json", prompt.lower())

    def test_builder_handoff_requires_meaningful_pr_and_exact_head(self):
        self.assertEqual(
            loop_runner.validate_builder_handoff(self.state, self.pr, expected_task=self.task),
            [],
        )

        wrong_head = dict(self.pr, headRefOid="b" * 40)
        self.assertIn("HEAD SHA", " ".join(loop_runner.validate_builder_handoff(self.state, wrong_head)))

        bad_body = dict(self.pr, body="Implements task")
        self.assertIn("PR body", " ".join(loop_runner.validate_builder_handoff(self.state, bad_body)))

        state_in_pr = dict(self.pr, files=self.pr["files"] + ["kanban/loop-state.json"])
        self.assertIn("loop-state.json", " ".join(loop_runner.validate_builder_handoff(self.state, state_in_pr)))

        wrong_task = dict(self.state, current_task_key="other.md#T-00")
        self.assertIn(
            "selected task",
            " ".join(loop_runner.validate_builder_handoff(wrong_task, self.pr, expected_task=self.task)),
        )

        stale_review = dict(self.state, review={"decision": "approve"})
        self.assertIn(
            "old review",
            " ".join(loop_runner.validate_builder_handoff(stale_review, self.pr, expected_task=self.task)),
        )

        bad_title = dict(self.pr, title="feat")
        self.assertIn(
            "PR title",
            " ".join(loop_runner.validate_builder_handoff(self.state, bad_title, expected_task=self.task)),
        )

        malformed_validation = dict(
            self.state,
            validation_results=[{"command": "pnpm test", "status": "maybe", "summary": "unknown"}],
        )
        self.assertIn(
            "validation_results",
            " ".join(
                loop_runner.validate_builder_handoff(
                    malformed_validation, self.pr, expected_task=self.task
                )
            ),
        )

    def test_review_artifact_is_strict_and_bound_to_pr_head(self):
        artifact = {
            "schema_version": 1,
            "task_key": self.task["key"],
            "pr_number": 231,
            "reviewed_head_sha": "a" * 40,
            "decision": "approve",
            "summary": "Meets the task and has adequate tests.",
            "issues": [],
        }
        self.assertEqual(
            loop_runner.validate_review_artifact(
                artifact,
                expected_task_key=self.task["key"],
                expected_pr_number=231,
                expected_head_sha="a" * 40,
            ),
            [],
        )
        stale = dict(artifact, reviewed_head_sha="b" * 40)
        self.assertIn(
            "reviewed_head_sha",
            " ".join(
                loop_runner.validate_review_artifact(
                    stale,
                    expected_task_key=self.task["key"],
                    expected_pr_number=231,
                    expected_head_sha="a" * 40,
                )
            ),
        )

    def test_approve_cannot_contain_blocking_issues(self):
        artifact = {
            "schema_version": 1,
            "task_key": self.task["key"],
            "pr_number": 231,
            "reviewed_head_sha": "a" * 40,
            "decision": "approve",
            "summary": "Contradictory review",
            "issues": [
                {
                    "severity": "major",
                    "file": "src/x.ts",
                    "line": 10,
                    "description": "Broken",
                    "suggestion": "Fix it",
                }
            ],
        }
        errors = loop_runner.validate_review_artifact(
            artifact,
            expected_task_key=self.task["key"],
            expected_pr_number=231,
            expected_head_sha="a" * 40,
        )
        self.assertTrue(any("blocking" in error for error in errors))

    def test_review_issue_objects_are_schema_checked_after_github_readback(self):
        artifact = {
            "schema_version": 1,
            "task_key": self.task["key"],
            "pr_number": 231,
            "reviewed_head_sha": "a" * 40,
            "decision": "approve",
            "summary": "Approved with one minor",
            "issues": [{"severity": "minor"}],
        }
        errors = loop_runner.validate_review_artifact(
            artifact,
            expected_task_key=self.task["key"],
            expected_pr_number=231,
            expected_head_sha="a" * 40,
        )
        self.assertTrue(any("issue fields" in error for error in errors))

    def test_marked_comment_parser_ignores_unmarked_prose(self):
        artifact = {
            "schema_version": 1,
            "task_key": self.task["key"],
            "pr_number": 231,
            "reviewed_head_sha": "a" * 40,
            "decision": "approve",
            "summary": "Approved",
            "issues": [],
        }
        comments = [
            {"body": "Looks good, approve", "url": "ignored"},
            {
                "body": loop_runner.REVIEW_MARKER + "\n```json\n" + json.dumps(artifact) + "\n```",
                "url": "https://github.com/comment/1",
            },
        ]
        parsed, url = loop_runner.latest_marked_review(comments)
        self.assertEqual(parsed, artifact)
        self.assertEqual(url, "https://github.com/comment/1")

    def test_in_review_handoff_allows_supervisor_nonce_after_crash(self):
        resumable = dict(self.state, review_nonce="persisted-before-comment")
        self.assertEqual(
            loop_runner.validate_builder_handoff(resumable, self.pr, expected_task=self.task),
            [],
        )

    def test_review_recovery_reuses_exact_existing_comment(self):
        artifact = {
            "schema_version": 1,
            "task_key": self.task["key"],
            "pr_number": 231,
            "reviewed_head_sha": "a" * 40,
            "decision": "approve",
            "summary": "Approved",
            "issues": [],
        }
        comments = [
            {
                "body": loop_runner.review_comment_body(artifact),
                "url": "https://github.com/comment/exact",
                "id": 1001,
                "author": "barghsadev",
            }
        ]
        recovered, comment = loop_runner.find_verified_review(
            self.state, self.pr, comments, expected_actor="barghsadev"
        )
        self.assertEqual(recovered, artifact)
        self.assertEqual(comment["id"], 1001)

        forged = [dict(comments[0], author="collaborator")]
        recovered, comment = loop_runner.find_verified_review(
            self.state, self.pr, forged, expected_actor="barghsadev"
        )
        self.assertIsNone(recovered)
        self.assertIsNone(comment)

    def test_merge_recovery_can_finalize_already_merged_pr(self):
        artifact = {
            "schema_version": 1,
            "task_key": self.task["key"],
            "pr_number": 231,
            "reviewed_head_sha": "a" * 40,
            "decision": "approve",
            "summary": "Approved",
            "issues": [],
        }
        approved_state = dict(
            self.state,
            status="approved",
            reviewed_head_sha="a" * 40,
            review=artifact,
        )
        merged_pr = dict(
            self.pr,
            state="MERGED",
            mergeable="UNKNOWN",
            statusCheckRollup=[self.successful_check()],
        )
        self.assertEqual(
            loop_runner.already_merged_finalization_errors(approved_state, merged_pr, artifact),
            [],
        )

    def test_merge_gate_requires_later_approved_state_exact_head_and_green_checks(self):
        artifact = {
            "schema_version": 1,
            "task_key": self.task["key"],
            "pr_number": 231,
            "reviewed_head_sha": "a" * 40,
            "decision": "approve",
            "summary": "Approved",
            "issues": [],
        }
        approved_state = dict(
            self.state,
            status="approved",
            reviewed_head_sha="a" * 40,
            review=artifact,
        )
        passing_pr = dict(self.pr, statusCheckRollup=[self.successful_check()])
        self.assertEqual(loop_runner.merge_gate_errors(approved_state, passing_pr, artifact), [])

        changed_artifact = dict(artifact, summary="Edited after verification")
        self.assertIn(
            "state review",
            " ".join(loop_runner.merge_gate_errors(approved_state, passing_pr, changed_artifact)),
        )

        self.assertIn(
            "status",
            " ".join(loop_runner.merge_gate_errors(self.state, passing_pr, artifact)),
        )
        changed = dict(self.pr, headRefOid="c" * 40)
        self.assertIn(
            "HEAD",
            " ".join(loop_runner.merge_gate_errors(approved_state, changed, artifact)),
        )
        failing = dict(
            self.pr,
            statusCheckRollup=[{"name": "test", "conclusion": "FAILURE", "status": "COMPLETED"}],
        )
        self.assertIn(
            "checks",
            " ".join(loop_runner.merge_gate_errors(approved_state, failing, artifact)),
        )
        self.assertIn(
            "checks",
            " ".join(loop_runner.merge_gate_errors(approved_state, self.pr, artifact)),
        )

        for conclusion in (None, "SKIPPED", "NEUTRAL", "STALE"):
            non_success = dict(
                self.pr,
                statusCheckRollup=[
                    {"name": "CI", "conclusion": conclusion, "status": "COMPLETED"}
                ],
            )
            self.assertIn(
                "checks",
                " ".join(loop_runner.merge_gate_errors(approved_state, non_success, artifact)),
            )

    def test_head_change_invalidates_all_approval_bindings(self):
        artifact = {
            "schema_version": 1,
            "task_key": self.task["key"],
            "pr_number": 231,
            "reviewed_head_sha": "a" * 40,
            "decision": "approve",
            "summary": "Approved",
            "issues": [],
        }
        state = dict(
            self.state,
            status="approved",
            review=artifact,
            reviewed_head_sha="a" * 40,
            review_comment_id=1001,
            review_comment_url="comment-url",
            review_comment_author="barghsadev",
            review_artifact_sha256=loop_runner.artifact_digest(artifact),
            review_nonce="nonce",
        )
        invalidated = loop_runner.invalidate_approval_for_new_head(state, "c" * 40)
        self.assertEqual(invalidated["status"], "in_review")
        self.assertEqual(invalidated["current_head_sha"], "c" * 40)
        for key in (
            "reviewed_head_sha",
            "review_comment_url",
            "review_comment_author",
            "review_artifact_sha256",
            "review_nonce",
        ):
            self.assertEqual(invalidated[key], "")
        self.assertIsNone(invalidated["review"])
        self.assertIsNone(invalidated["review_comment_id"])

    def test_merge_command_atomically_matches_reviewed_head(self):
        command = loop_runner.merge_command("https://github.com/o/r/pull/1", "a" * 40)
        self.assertIn("--match-head-commit", command)
        index = command.index("--match-head-commit")
        self.assertEqual(command[index + 1], "a" * 40)

    def test_handle_merge_invalidates_changed_head_before_comment_lookup_or_merge(self):
        artifact = {
            "schema_version": 1,
            "task_key": self.task["key"],
            "pr_number": 231,
            "reviewed_head_sha": "a" * 40,
            "decision": "approve",
            "summary": "Approved",
            "issues": [],
        }
        approved_state = dict(
            self.state,
            status="approved",
            review=artifact,
            reviewed_head_sha="a" * 40,
            review_comment_id=1001,
            review_comment_url="comment-url",
            review_comment_author="barghsadev",
            review_artifact_sha256=loop_runner.artifact_digest(artifact),
            review_nonce="nonce",
        )
        changed_pr = dict(
            self.pr,
            headRefOid="c" * 40,
            statusCheckRollup=[self.successful_check()],
        )
        old_load = loop_runner.load_json
        old_snapshot = loop_runner.pr_snapshot
        old_save = loop_runner.save_json
        old_comments = loop_runner.comments_snapshot
        old_actor = loop_runner.github_actor
        old_run = loop_runner.run
        saved = []
        calls = []
        loop_runner.load_json = lambda path: dict(approved_state)
        loop_runner.pr_snapshot = lambda url: changed_pr
        loop_runner.save_json = lambda path, value: saved.append(dict(value))
        loop_runner.comments_snapshot = lambda url: self.fail("comment lookup must not run")
        loop_runner.github_actor = lambda: self.fail("actor lookup must not run")
        loop_runner.run = lambda *args, **kwargs: calls.append(args)
        try:
            loop_runner.handle_merge()
        finally:
            loop_runner.load_json = old_load
            loop_runner.pr_snapshot = old_snapshot
            loop_runner.save_json = old_save
            loop_runner.comments_snapshot = old_comments
            loop_runner.github_actor = old_actor
            loop_runner.run = old_run
        self.assertEqual(saved[-1]["status"], "in_review")
        self.assertIsNone(saved[-1]["review"])
        self.assertEqual(calls, [])

        # The same mismatch must invalidate before provenance lookup even if
        # GitHub already reports MERGED (crash-recovery path).
        saved.clear()
        merged_changed_pr = dict(changed_pr, state="MERGED", mergeable="UNKNOWN")
        loop_runner.load_json = lambda path: dict(approved_state)
        loop_runner.pr_snapshot = lambda url: merged_changed_pr
        loop_runner.save_json = lambda path, value: saved.append(dict(value))
        loop_runner.comments_snapshot = lambda url: self.fail("comment lookup must not run")
        loop_runner.github_actor = lambda: self.fail("actor lookup must not run")
        try:
            loop_runner.handle_merge()
        finally:
            loop_runner.load_json = old_load
            loop_runner.pr_snapshot = old_snapshot
            loop_runner.save_json = old_save
            loop_runner.comments_snapshot = old_comments
            loop_runner.github_actor = old_actor
            loop_runner.run = old_run
        self.assertEqual(saved[-1]["status"], "in_review")
        self.assertIsNone(saved[-1]["review"])

    def test_post_merge_refetches_review_binding_before_finalizing(self):
        artifact = {
            "schema_version": 1,
            "task_key": self.task["key"],
            "pr_number": 231,
            "reviewed_head_sha": "a" * 40,
            "decision": "approve",
            "summary": "Approved",
            "issues": [],
        }
        comment = {
            "id": 1001,
            "url": "comment-url",
            "author": "barghsadev",
            "body": loop_runner.review_comment_body(artifact, "nonce"),
        }
        state = dict(
            self.state,
            status="approved",
            review=artifact,
            reviewed_head_sha="a" * 40,
            review_comment_id=1001,
            review_comment_url="comment-url",
            review_comment_author="barghsadev",
            review_artifact_sha256=loop_runner.artifact_digest(artifact),
            review_nonce="nonce",
        )
        open_pr = dict(self.pr, statusCheckRollup=[self.successful_check()])
        merged_pr = dict(open_pr, state="MERGED", mergeable="UNKNOWN")
        snapshots = iter([open_pr, merged_pr])
        comment_reads = iter([[comment], []])
        saved = []
        old_load = loop_runner.load_json
        old_snapshot = loop_runner.pr_snapshot
        old_comments = loop_runner.comments_snapshot
        old_actor = loop_runner.github_actor
        old_run = loop_runner.run
        old_save = loop_runner.save_json
        loop_runner.load_json = lambda path: dict(state)
        loop_runner.pr_snapshot = lambda url: next(snapshots)
        loop_runner.comments_snapshot = lambda url: next(comment_reads)
        loop_runner.github_actor = lambda: "barghsadev"
        loop_runner.run = lambda *args, **kwargs: type("R", (), {"returncode": 0, "stderr": ""})()
        loop_runner.save_json = lambda path, value: saved.append(dict(value))
        try:
            loop_runner.handle_merge()
        finally:
            loop_runner.load_json = old_load
            loop_runner.pr_snapshot = old_snapshot
            loop_runner.comments_snapshot = old_comments
            loop_runner.github_actor = old_actor
            loop_runner.run = old_run
            loop_runner.save_json = old_save
        self.assertNotIn(self.task["key"], saved[-1].get("build_completed_tasks", []))
        self.assertIn("Post-merge", saved[-1]["last_error"])

    def test_review_head_must_still_match_before_artifact_is_posted(self):
        changed_pr = dict(self.pr, headRefOid="c" * 40)
        self.assertIn(
            "HEAD changed",
            " ".join(loop_runner.review_snapshot_errors(self.pr, changed_pr)),
        )
        self.assertEqual(loop_runner.review_snapshot_errors(self.pr, dict(self.pr)), [])

    def test_review_transition_never_merges_in_review_tick(self):
        approved = {
            "schema_version": 1,
            "task_key": self.task["key"],
            "pr_number": 231,
            "reviewed_head_sha": "a" * 40,
            "decision": "approve",
            "summary": "Approved",
            "issues": [],
        }
        comment = {
            "id": 1001,
            "url": "comment-url",
            "author": "barghsadev",
            "body": loop_runner.review_comment_body(approved),
        }
        next_state = loop_runner.apply_verified_review(
            dict(self.state), approved, comment, expected_actor="barghsadev"
        )
        self.assertEqual(next_state["status"], "approved")
        self.assertEqual(next_state["reviewed_head_sha"], "a" * 40)
        self.assertEqual(next_state["review_comment_url"], "comment-url")

    def test_commands_use_separate_subscription_clis(self):
        builder = loop_runner.builder_command("prompt")
        reviewer = loop_runner.reviewer_command(Path("prompt.txt"), Path("schema.json"), Path("out.json"))
        self.assertEqual(builder[0], "agent")
        self.assertIn("cursor-grok-4.6-high", builder)
        self.assertEqual(reviewer[0], "codex")
        self.assertIn("gpt-5.6-sol", reviewer)
        self.assertNotIn("agent", reviewer)

    def test_review_prompt_names_exact_branch_diff(self):
        old_queue = loop_runner.QUEUE_FILE
        old_epics = loop_runner.EPICS_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            epic_dir = root / "epics"
            epic_dir.mkdir()
            (root / "queue.json").write_text(json.dumps([self.task]))
            (epic_dir / self.task["fname"]).write_text(
                f"**{self.task['id']} — {self.task['title']}**\n- Description: fixture\n"
            )
            loop_runner.QUEUE_FILE = root / "queue.json"
            loop_runner.EPICS_DIR = epic_dir
            try:
                prompt = loop_runner.review_prompt(self.state, self.pr)
            finally:
                loop_runner.QUEUE_FILE = old_queue
                loop_runner.EPICS_DIR = old_epics
        self.assertIn(f"{self.pr['baseRefOid']}...{self.pr['headRefOid']}", prompt)
        self.assertNotIn(f"origin/main...{self.pr['headRefName']}", prompt)

    def test_advisory_lock_is_exclusive_and_reusable(self):
        old_lock = loop_runner.LOCK_FILE
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "loop.lock"
            loop_runner.LOCK_FILE = lock
            try:
                self.assertTrue(loop_runner.acquire_lock())
                self.assertFalse(loop_runner.acquire_lock())
                loop_runner.release_lock()
                self.assertTrue(loop_runner.acquire_lock())
                loop_runner.release_lock()
            finally:
                loop_runner.LOCK_FILE = old_lock

    def test_comment_binding_requires_id_author_and_digest(self):
        artifact = {
            "schema_version": 1,
            "task_key": self.task["key"],
            "pr_number": 231,
            "reviewed_head_sha": "a" * 40,
            "decision": "approve",
            "summary": "Approved",
            "issues": [],
        }
        comment = {
            "id": 1001,
            "url": "https://github.com/comment/1001",
            "author": "barghsadev",
            "body": loop_runner.review_comment_body(artifact),
        }
        bound = loop_runner.apply_verified_review(
            dict(self.state), artifact, comment, expected_actor="barghsadev"
        )
        self.assertEqual(bound["review_comment_id"], 1001)
        self.assertEqual(bound["review_comment_author"], "barghsadev")
        self.assertEqual(bound["review_artifact_sha256"], loop_runner.artifact_digest(artifact))

        edited = dict(artifact, summary="edited")
        self.assertIn(
            "digest",
            " ".join(loop_runner.review_binding_errors(bound, comment, edited)),
        )


if __name__ == "__main__":
    unittest.main()
