#!/usr/bin/env python3
"""Barghsa deterministic supervisor.

Cursor owns build/fix transactions: implementation, validation, commit, push,
meaningful PR creation/update, and the in_review state handoff.
Codex owns the durable structured review artifact posted to the PR.
The supervisor only selects, dispatches, verifies, and—on a later approved tick—merges.
"""

from __future__ import annotations

import json
import fcntl
import hashlib
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from build_backlog import task_context
from loop_state import StateStore, atomic_json

BASE = Path(os.environ.get("BARGHSA_LOOP_BASE", str(Path(__file__).resolve().parents[2])))
STATE_DIR = Path(os.environ.get("BARGHSA_LOOP_STATE_DIR", str(Path.home() / ".local/state/barghsa-loop")))
STATE_FILE = STATE_DIR / "state.json"
HANDOFF_FILE = STATE_DIR / "builder-handoff.json"
STORE: StateStore | None = None
QUEUE_FILE = BASE / "kanban/task-queue.json"
EPICS_DIR = BASE / "kanban/epics"
LOCK_FILE = Path("/tmp/barghsa-loop-runner.lock")
REVIEW_SCHEMA = BASE / "kanban/scripts/review-schema.json"
BUILDER_MODEL = "cursor-grok-4.6-high"
REVIEWER_MODEL = "gpt-5.6-sol"
REVIEW_MARKER = "<!-- barghsa-codex-review:v1 -->"
MAX_FIX_ATTEMPTS = 3
_LOCK_HANDLE: Any = None


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def save_json(path: Path, value: Any) -> None:
    if path == STATE_FILE and STORE is not None:
        STORE.save(value)
    else:
        atomic_json(path, value)


def run(argv: list[str], *, timeout: int | None = None, check: bool = False) -> subprocess.CompletedProcess[str]:
    log("$ " + " ".join(argv))
    result = subprocess.run(
        argv,
        cwd=BASE,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    if check and result.returncode:
        raise RuntimeError(f"command failed ({result.returncode}): {' '.join(argv)}\n{result.stderr[-2000:]}")
    return result


def action_for_status(status: str) -> str:
    return {
        "idle": "cursor_build",
        "building": "cursor_build",
        "fixing": "cursor_fix",
        "in_review": "codex_review",
        "approved": "merge",
        "blocked": "noop",
        "complete": "noop",
    }.get(status, "noop")


def push_history(state: dict[str, Any], status: str, task_key: str | None = None) -> None:
    history = state.setdefault("status_history", [])
    history.insert(
        0,
        {
            "status": status,
            "task_key": task_key if task_key is not None else state.get("current_task_key", ""),
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
    )
    state["status_history"] = history[:100]
    state["last_updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def acquire_lock() -> bool:
    """Acquire an OS advisory lock held by an open descriptor."""
    global _LOCK_HANDLE
    if _LOCK_HANDLE is not None:
        return False
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    handle = LOCK_FILE.open("a+")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        return False
    handle.seek(0)
    handle.truncate()
    handle.write(str(os.getpid()))
    handle.flush()
    _LOCK_HANDLE = handle
    return True


def release_lock() -> None:
    global _LOCK_HANDLE
    if _LOCK_HANDLE is None:
        return
    fcntl.flock(_LOCK_HANDLE.fileno(), fcntl.LOCK_UN)
    _LOCK_HANDLE.close()
    _LOCK_HANDLE = None


def task_section(task: dict[str, Any]) -> str:
    return task_context(task, EPICS_DIR)


def next_task(state: dict[str, Any]) -> dict[str, Any] | None:
    completed = set(state.get("build_completed_tasks", []))
    dispositions = {event["task_key"]: event["disposition"] for event in state.get("task_events", [])}
    for entry in load_json(QUEUE_FILE):
        disposition = dispositions.get(entry["key"])
        if disposition in {"partial", "blocked"}:
            raise RuntimeError(f"task needs acceptance repair before new dispatch: {entry['key']}")
        if entry["key"] not in completed and disposition not in {"deferred", "retired", "acceptance_verified", "merged"}:
            return entry
    return None


def safe_branch(task: dict[str, Any]) -> str:
    epic = task["fname"].split("-", 1)[0]
    task_slug = task["id"].lower().replace(".", "-")
    title = re.sub(r"[^a-z0-9_-]+", "-", task["title"].lower()).strip("-")[:36]
    return f"feat/e{epic}-{task_slug}--{title}"


def build_cursor_prompt(
    *, task: dict[str, Any], task_section: str, state: dict[str, Any], mode: str
) -> str:
    branch = state.get("current_branch") or safe_branch(task)
    pr_number = state.get("current_pr_number")
    pr_url = state.get("current_pr_url")
    review = state.get("review") or {}
    review_json = json.dumps(review, indent=2, ensure_ascii=False)
    mode_instructions = (
        "Implement the task from origin/main on the dedicated branch."
        if mode == "build"
        else (
            f"Fix every critical/major finding on the SAME branch and PR ({pr_url or pr_number}). "
            "Do not create a replacement PR.\nVerified review artifact:\n" + review_json
        )
    )
    return f"""You are the sole builder and PR author for the Barghsa loop.

Task key: {task['key']}
Task file: {task['fname']}
Task ID: {task['id']}
Task title: {task['title']}
Required branch: {branch}
Mode: {mode}

Exact task context:
{task_section}

{mode_instructions}

You own this complete transaction. Do not return success until every required artifact exists:
1. Reconcile git/GitHub first. Use the required branch. For build, create it from current origin/main if absent. For fix, resume the existing branch/PR.
2. The supervisor has persisted your assignment. Do not edit supervisor state or kanban/loop-state.json. Write your result only to {HANDOFF_FILE}.
3. Implement only this task and directly required scaffolding. Follow repository AGENTS.md and existing patterns.
4. Run the task-specific checks and every relevant available root/package check. Record exact commands and truthful results.
5. Use git commit with a meaningful conventional commit message. Do not leave implementation changes uncommitted.
6. Use git push to push the branch.
7. Use gh pr create --draft for a new PR, or gh pr edit for the existing PR. You—not the supervisor—must write a meaningful PR title and body containing all sections below:
   - `## What`: concrete implementation summary
   - `## Acceptance criteria`: truthful checked/unchecked criteria with explanations
   - `## Validation`: exact commands and pass/fail/not-available outcomes
   - `## Risks / limitations`: any known limits, otherwise `None`
8. Mark the PR ready only after applicable validation passes.
9. Read back the PR via gh and obtain its number, URL, head branch, and exact 40-character head SHA.
10. Write {HANDOFF_FILE} as a JSON object containing only the fields below. Include assignment_id "{(state.get("assignment") or {}).get("id", "")}". Any fix commit invalidates the prior review: set `review` to null and clear `reviewed_head_sha`, `review_comment_id`, `review_comment_url`, `review_comment_author`, `review_artifact_sha256`, and `review_nonce` before the in_review handoff.
   "assignment_id": "{(state.get("assignment") or {}).get("id", "")}",
   "status": "in_review",
   "current_task_key": "{task['key']}",
   "current_task_id": "{task['id']}",
   "current_task_file": "{task['fname']}",
   "current_branch": "{branch}",
   "current_pr_number": <actual integer>,
   "current_pr_url": <actual URL>,
   "current_head_sha": <actual 40-character SHA>,
   "review": null,
   "reviewed_head_sha": "",
   "review_comment_id": null,
   "review_comment_url": "",
   "review_comment_author": "",
   "review_artifact_sha256": "",
   "review_nonce": "",
   "validation_results": [{{"command": "...", "status": "passed|failed|not_available", "summary": "..."}}],
   "last_error": ""
11. Do not stage or commit kanban/loop-state.json or the external handoff file. Do not change the supervisor state, assignment or completion history.
12. Verify the PR head SHA equals current_head_sha and the PR body is meaningful. Do not merely describe commands—execute them.

Return a concise summary only after the transaction is complete. If blocked, leave truthful resumable state with last_error and do not create misleading artifacts.
"""


def builder_command(prompt: str) -> list[str]:
    return [
        "agent",
        "-p",
        prompt,
        "--model",
        BUILDER_MODEL,
        "--trust",
        "--force",
        "--print",
        "--output-format",
        "text",
    ]


def reviewer_command(prompt_path: Path, schema_path: Path, output_path: Path) -> list[str]:
    return [
        "codex",
        "exec",
        "-",
        "-m",
        REVIEWER_MODEL,
        "-C",
        str(BASE),
        "-s",
        "read-only",
        "--ephemeral",
        "--output-schema",
        str(schema_path),
        "--output-last-message",
        str(output_path),
    ]


def gh_json(args: list[str]) -> Any:
    result = run(["gh", *args], timeout=60, check=True)
    return json.loads(result.stdout)


def pr_snapshot(pr_url: str) -> dict[str, Any]:
    return gh_json(
        [
            "pr",
            "view",
            pr_url,
            "--json",
            "number,title,url,state,isDraft,mergeable,baseRefName,baseRefOid,headRefName,headRefOid,body,files,statusCheckRollup",
        ]
    )


def comments_snapshot(pr_url: str) -> list[dict[str, Any]]:
    match = re.fullmatch(r"https://github\.com/([^/]+)/([^/]+)/pull/(\d+)", pr_url)
    if not match:
        raise RuntimeError(f"unsupported PR URL: {pr_url}")
    owner, repo, number = match.groups()
    pages = gh_json(["api", "--paginate", "--slurp", f"repos/{owner}/{repo}/issues/{number}/comments?per_page=100"])
    comments = [comment for page in pages for comment in page]
    return [
        {
            "body": item.get("body", ""),
            "url": item.get("html_url"),
            "id": item.get("id"),
            "author": (item.get("user") or {}).get("login"),
        }
        for item in comments
    ]


def github_actor() -> str:
    result = run(["gh", "api", "user", "--jq", ".login"], timeout=30, check=True)
    actor = result.stdout.strip()
    if not actor:
        raise RuntimeError("authenticated GitHub actor is empty")
    return actor


def materialize_review_commits(pr: dict[str, Any]) -> None:
    base_sha = pr.get("baseRefOid", "")
    head_sha = pr.get("headRefOid", "")
    pr_number = pr.get("number")
    if (
        not re.fullmatch(r"[0-9a-f]{40}", base_sha)
        or not re.fullmatch(r"[0-9a-f]{40}", head_sha)
        or not isinstance(pr_number, int)
    ):
        raise RuntimeError("PR base/head identity is invalid")
    # Fetch advertised refs, then independently verify they resolve to the exact
    # immutable SHAs GitHub reported before Codex starts.
    run(
        [
            "git",
            "fetch",
            "--force",
            "origin",
            "+refs/heads/main:refs/remotes/origin/main",
            f"+refs/pull/{pr_number}/head:refs/remotes/origin/barghsa-review-{pr_number}",
        ],
        timeout=120,
        check=True,
    )
    # A PR's advertised base SHA is immutable for this review request, but
    # refs/heads/main may advance after the PR was opened. Verify that exact
    # base object exists rather than incorrectly requiring current main to
    # still equal the PR's original base.
    run(["git", "cat-file", "-e", f"{base_sha}^{{commit}}"], timeout=30, check=True)
    resolved_head = run(
        ["git", "rev-parse", f"origin/barghsa-review-{pr_number}^{{commit}}"],
        timeout=30,
        check=True,
    ).stdout.strip()
    if resolved_head != head_sha:
        raise RuntimeError(
            f"materialized review head does not match GitHub SHA: "
            f"{resolved_head}!={head_sha}"
        )


def validate_builder_handoff(
    state: dict[str, Any],
    pr: dict[str, Any],
    *,
    expected_task: dict[str, Any] | None = None,
) -> list[str]:
    errors: list[str] = []
    if expected_task:
        if state.get("current_task_key") != expected_task.get("key"):
            errors.append("state does not match selected task key")
        if state.get("current_branch") != safe_branch(expected_task):
            errors.append("state does not use the required selected task branch")
        if state.get("current_task_id") != expected_task.get("id"):
            errors.append("state does not match selected task id")
        if state.get("current_task_file") != expected_task.get("fname"):
            errors.append("state does not match selected task file")
    if state.get("status") != "in_review":
        errors.append("builder did not set status to in_review")
    if not state.get("current_pr_number") or state.get("current_pr_number") != pr.get("number"):
        errors.append("PR number does not match state")
    if state.get("current_pr_url") != pr.get("url"):
        errors.append("PR URL does not match state")
    if state.get("current_branch") != pr.get("headRefName"):
        errors.append("PR branch does not match state")
    if state.get("current_head_sha") != pr.get("headRefOid"):
        errors.append("PR HEAD SHA does not match current_head_sha")
    if pr.get("baseRefName") != "main":
        errors.append("PR base branch is not main")
    if pr.get("state") != "OPEN":
        errors.append("PR is not open")
    if pr.get("isDraft"):
        errors.append("PR is still draft")
    title = pr.get("title") or ""
    if len(title) < 20 or title.lower() in {"feat", "fix", "chore"}:
        errors.append("PR title is not meaningful")
    body = pr.get("body") or ""
    required = ("## What", "## Acceptance criteria", "## Validation", "## Risks / limitations")
    if any(section not in body for section in required) or len(body) < 120:
        errors.append("PR body is not meaningful or lacks required sections")
    files = [item.get("path", item) if isinstance(item, dict) else item for item in pr.get("files", [])]
    if "kanban/loop-state.json" in files:
        errors.append("PR must not include kanban/loop-state.json")
    if (
        state.get("review") not in (None, {})
        or state.get("reviewed_head_sha")
        or state.get("review_comment_id")
        or state.get("review_comment_url")
        or state.get("review_comment_author")
        or state.get("review_artifact_sha256")
    ):
        errors.append("builder handoff retains an old review")
    results = state.get("validation_results")
    valid_statuses = {"passed", "failed", "not_available"}
    if not isinstance(results, list) or not results:
        errors.append("validation_results missing")
    elif any(
        not isinstance(item, dict)
        or set(item) != {"command", "status", "summary"}
        or not isinstance(item.get("command"), str)
        or not item.get("command")
        or item.get("status") not in valid_statuses
        or not isinstance(item.get("summary"), str)
        for item in results
    ):
        errors.append("validation_results are malformed")
    elif any(item["status"] == "failed" for item in results):
        errors.append("builder recorded failed validation")
    return errors


def validate_review_artifact(
    artifact: dict[str, Any], *, expected_task_key: str, expected_pr_number: int, expected_head_sha: str
) -> list[str]:
    errors: list[str] = []
    required = {
        "schema_version",
        "task_key",
        "pr_number",
        "reviewed_head_sha",
        "decision",
        "summary",
        "issues",
    }
    if set(artifact) != required:
        errors.append("review artifact fields do not match schema")
    if artifact.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    if artifact.get("task_key") != expected_task_key:
        errors.append("task_key mismatch")
    if artifact.get("pr_number") != expected_pr_number:
        errors.append("pr_number mismatch")
    if artifact.get("reviewed_head_sha") != expected_head_sha:
        errors.append("reviewed_head_sha mismatch")
    if artifact.get("decision") not in {"approve", "request_changes"}:
        errors.append("invalid decision")
    if not isinstance(artifact.get("summary"), str) or len(artifact.get("summary", "")) < 3:
        errors.append("summary missing")
    issues = artifact.get("issues")
    if not isinstance(issues, list):
        errors.append("issues must be an array")
        issues = []
    blocking = False
    for issue in issues:
        if not isinstance(issue, dict):
            errors.append("invalid issue")
            continue
        required_issue_fields = {"severity", "file", "line", "description", "suggestion"}
        if set(issue) != required_issue_fields:
            errors.append("review issue fields do not match schema")
        if issue.get("severity") not in {"critical", "major", "minor"}:
            errors.append("invalid issue severity")
        if not isinstance(issue.get("file"), str):
            errors.append("invalid issue file")
        if not isinstance(issue.get("line"), int) or issue.get("line", -1) < 0:
            errors.append("invalid issue line")
        if not isinstance(issue.get("description"), str) or len(issue.get("description", "")) < 3:
            errors.append("invalid issue description")
        if not isinstance(issue.get("suggestion"), str) or len(issue.get("suggestion", "")) < 3:
            errors.append("invalid issue suggestion")
        if issue.get("severity") in {"critical", "major"}:
            blocking = True
    if artifact.get("decision") == "approve" and blocking:
        errors.append("approve decision cannot contain blocking issues")
    if artifact.get("decision") == "request_changes" and not blocking:
        errors.append("request_changes requires a critical or major issue")
    return errors


def canonical_artifact(artifact: dict[str, Any]) -> str:
    return json.dumps(artifact, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def artifact_digest(artifact: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_artifact(artifact).encode()).hexdigest()


def review_comment_body(artifact: dict[str, Any], nonce: str | None = None) -> str:
    nonce_line = f"<!-- nonce:{nonce} -->\n" if nonce else ""
    return (
        f"{REVIEW_MARKER}\n{nonce_line}"
        f"```json\n{json.dumps(artifact, indent=2, ensure_ascii=False)}\n```"
    )


def latest_marked_review(comments: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str | None]:
    """Compatibility parser used by unit tests and diagnostics."""
    for comment in reversed(comments):
        body = comment.get("body") or ""
        if REVIEW_MARKER not in body:
            continue
        match = re.search(r"```json\s*(\{.*\})\s*```", body, re.DOTALL)
        if not match:
            continue
        try:
            return json.loads(match.group(1)), comment.get("url")
        except json.JSONDecodeError:
            continue
    return None, None


def find_verified_review(
    state: dict[str, Any],
    pr: dict[str, Any],
    comments: list[dict[str, Any]],
    *,
    expected_actor: str,
    nonce: str | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    for comment in reversed(comments):
        body = comment.get("body") or ""
        if comment.get("author") != expected_actor or REVIEW_MARKER not in body:
            continue
        if nonce and f"<!-- nonce:{nonce} -->" not in body:
            continue
        match = re.search(r"```json\s*(\{.*\})\s*```", body, re.DOTALL)
        if not match:
            continue
        try:
            artifact = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        errors = validate_review_artifact(
            artifact,
            expected_task_key=state.get("current_task_key", ""),
            expected_pr_number=pr.get("number", 0),
            expected_head_sha=pr.get("headRefOid", ""),
        )
        if not errors:
            return artifact, comment
    return None, None


def review_binding_errors(
    state: dict[str, Any], comment: dict[str, Any], artifact: dict[str, Any]
) -> list[str]:
    errors: list[str] = []
    if state.get("review_comment_id") != comment.get("id"):
        errors.append("review comment id mismatch")
    if state.get("review_comment_author") != comment.get("author"):
        errors.append("review comment author mismatch")
    if state.get("review_comment_url") != comment.get("url"):
        errors.append("review comment URL mismatch")
    if state.get("review_artifact_sha256") != artifact_digest(artifact):
        errors.append("review artifact digest mismatch")
    if state.get("review") != artifact:
        errors.append("durable artifact differs from state review")
    return errors


def apply_verified_review(
    state: dict[str, Any],
    artifact: dict[str, Any],
    comment: dict[str, Any],
    *,
    expected_actor: str,
) -> dict[str, Any]:
    if comment.get("author") != expected_actor:
        raise ValueError("review comment actor mismatch")
    state["review"] = artifact
    state["reviewed_head_sha"] = artifact["reviewed_head_sha"]
    state["review_comment_id"] = comment["id"]
    state["review_comment_url"] = comment["url"]
    state["review_comment_author"] = comment["author"]
    state["review_artifact_sha256"] = artifact_digest(artifact)
    state["last_error"] = ""
    if artifact["decision"] == "approve":
        state["status"] = "approved"
        push_history(state, "approved")
    else:
        state["status"] = "fixing"
        state["fix_attempts"] = state.get("fix_attempts", 0) + 1
        push_history(state, "fixing")
    return state


def failing_checks(pr: dict[str, Any]) -> list[str]:
    checks = pr.get("statusCheckRollup") or []
    if not checks:
        return ["no checks reported"]
    failures: list[str] = []
    for check in checks:
        name = check.get("name") or check.get("context") or "unknown"
        conclusion = (check.get("conclusion") or "").upper()
        status = (check.get("status") or "").upper()
        if status != "COMPLETED" or conclusion != "SUCCESS":
            failures.append(f"{name}: status={status or 'missing'} conclusion={conclusion or 'missing'}")
    return failures


def merge_gate_errors(
    state: dict[str, Any], pr: dict[str, Any], artifact: dict[str, Any] | None
) -> list[str]:
    errors: list[str] = []
    if state.get("status") != "approved":
        errors.append("state status is not approved")
    if pr.get("state") != "OPEN":
        errors.append("PR is not open")
    if pr.get("isDraft"):
        errors.append("PR is draft")
    if pr.get("mergeable") != "MERGEABLE":
        errors.append("PR is not mergeable")
    if not artifact:
        errors.append("durable review artifact missing")
        return errors
    review_errors = validate_review_artifact(
        artifact,
        expected_task_key=state.get("current_task_key", ""),
        expected_pr_number=state.get("current_pr_number", 0),
        expected_head_sha=pr.get("headRefOid", ""),
    )
    errors.extend(review_errors)
    if artifact.get("decision") != "approve":
        errors.append("review decision is not approve")
    if state.get("review") != artifact:
        errors.append("durable artifact differs from state review")
    if state.get("reviewed_head_sha") != pr.get("headRefOid"):
        errors.append("PR HEAD changed after approval")
    if failing_checks(pr):
        errors.append("required checks are failing or pending")
    return errors


def already_merged_finalization_errors(
    state: dict[str, Any], pr: dict[str, Any], artifact: dict[str, Any] | None
) -> list[str]:
    errors: list[str] = []
    if state.get("status") != "approved":
        errors.append("state status is not approved")
    if pr.get("state") != "MERGED":
        errors.append("PR is not merged")
    if not artifact:
        errors.append("durable review artifact missing")
        return errors
    errors.extend(
        validate_review_artifact(
            artifact,
            expected_task_key=state.get("current_task_key", ""),
            expected_pr_number=state.get("current_pr_number", 0),
            expected_head_sha=pr.get("headRefOid", ""),
        )
    )
    if artifact.get("decision") != "approve":
        errors.append("review decision is not approve")
    if state.get("review") != artifact:
        errors.append("durable artifact differs from state review")
    if state.get("reviewed_head_sha") != pr.get("headRefOid"):
        errors.append("merged PR HEAD differs from approved HEAD")
    return errors


def select_or_resume_task(state: dict[str, Any]) -> tuple[dict[str, Any], str]:
    key = state.get("current_task_key")
    if key:
        if state.get("status") == "idle":
            raise RuntimeError("idle state retains an active task; explicit recovery required")
        if key in state.get("build_completed_tasks", []):
            raise RuntimeError("completed task cannot be resumed")
        task = next((item for item in load_json(QUEUE_FILE) if item["key"] == key), None)
        if not task:
            raise RuntimeError(f"active task not found in queue: {key}")
        return task, "fix" if state.get("status") == "fixing" else "build"
    if state.get("status") != "idle":
        raise RuntimeError("active state has no assigned task")
    task = next_task(state)
    if not task:
        state["status"] = "complete"
        push_history(state, "complete")
        save_json(STATE_FILE, state)
        raise StopIteration
    return task, "build"


def assignment_errors(state: dict[str, Any]) -> list[str]:
    assignment = state.get("assignment")
    if not isinstance(assignment, dict):
        return ["supervisor assignment missing; reconcile legacy state before resuming"]
    task = next((item for item in load_json(QUEUE_FILE) if item["key"] == assignment.get("task_key")), None)
    if not task:
        return ["assigned task is no longer in the canonical queue"]
    expected = {
        "current_task_key": task["key"], "current_task_id": task["id"],
        "current_task_file": task["fname"], "current_branch": assignment.get("branch"),
    }
    errors = [f"assignment mismatch: {field}" for field, value in expected.items() if state.get(field) != value]
    digest = hashlib.sha256(task_section(task).encode()).hexdigest()
    if assignment.get("requirements_sha256") != digest:
        errors.append("assigned requirements changed; explicit recovery required")
    if assignment.get("branch") != safe_branch(task):
        errors.append("assigned branch no longer matches canonical task")
    if task["key"] in state.get("build_completed_tasks", []):
        errors.append("assigned task is already merged")
    return errors


def record_task_event(state: dict[str, Any], disposition: str, **evidence: Any) -> None:
    state.setdefault("task_events", []).append({
        "task_key": state.get("current_task_key"), "disposition": disposition,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **evidence,
    })


HANDOFF_FIELDS = {
    "assignment_id", "status", "current_task_key", "current_task_id", "current_task_file",
    "current_branch", "current_pr_number", "current_pr_url", "current_head_sha",
    "validation_results", "review", "reviewed_head_sha", "review_comment_id",
    "review_comment_url", "review_comment_author", "review_artifact_sha256", "review_nonce", "last_error",
}


def dispatch_conflicts(task: dict[str, Any], state: dict[str, Any], prs: list[dict[str, Any]]) -> list[str]:
    """Legacy IDs can be ambiguous across epics. Block for reconciliation, never
    infer task completion from title/branch matching alone.
    """
    conflicts = []
    for pr in prs:
        branch = (pr.get("head") or {}).get("ref", "")
        if pr.get("state") == "open" and branch.startswith("feat/e") and pr.get("number") != state.get("current_pr_number"):
            conflicts.append(f"loop-owned PR #{pr['number']} is already open")
        scope = (pr.get("title") or "") + "\n" + (pr.get("body") or "")
        mentions_id = re.search(r"(?<![\w.])" + re.escape(task["id"]) + r"(?![\w.])", scope)
        if pr.get("merged_at") and (mentions_id or branch == safe_branch(task)):
            conflicts.append(f"merged PR #{pr['number']} may already implement {task['key']}; reconcile its evidence")
    return conflicts


def verify_dispatch_available(task: dict[str, Any], state: dict[str, Any]) -> None:
    pages = gh_json(["api", "--paginate", "--slurp", "repos/{owner}/{repo}/pulls?state=all&per_page=100"])
    if not isinstance(pages, list) or any(not isinstance(page, list) for page in pages):
        raise RuntimeError("GitHub PR reconciliation returned malformed pages")
    conflicts = dispatch_conflicts(task, state, [pr for page in pages for pr in page])
    if conflicts:
        raise RuntimeError("; ".join(conflicts))


def accept_handoff(state: dict[str, Any], handoff: dict[str, Any], task: dict[str, Any], pr: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(handoff, dict) or set(handoff) != HANDOFF_FIELDS:
        raise ValueError("builder handoff fields do not match the contract")
    if handoff["assignment_id"] != state["assignment"]["id"]:
        raise ValueError("builder handoff is from another assignment")
    if handoff.get("review_nonce"):
        raise ValueError("builder handoff retains a review nonce")
    if state.get("current_pr_number") and (
        handoff["current_pr_number"] != state["current_pr_number"]
        or handoff["current_pr_url"] != state["current_pr_url"]
    ):
        raise ValueError("builder replaced the assigned PR")
    errors = validate_builder_handoff(handoff, pr, expected_task=task)
    if errors:
        raise ValueError("; ".join(errors))
    result = dict(state)
    result.update({key: value for key, value in handoff.items() if key != "assignment_id"})
    return result


def handle_cursor() -> None:
    state = load_json(STATE_FILE)
    try:
        task, mode = select_or_resume_task(state)
    except StopIteration:
        return
    verify_dispatch_available(task, state)
    if mode == "fix" and state.get("fix_attempts", 0) > MAX_FIX_ATTEMPTS:
        state["status"] = "blocked"
        state["last_error"] = "three fix rounds failed review"
        push_history(state, "blocked")
        save_json(STATE_FILE, state)
        return
    if not state.get("assignment"):
        if state.get("status") != "idle":
            raise RuntimeError("legacy active task requires explicit reconciliation")
        state.update(current_task_key=task["key"], current_task_id=task["id"],
                     current_task_file=task["fname"], current_branch=safe_branch(task), status="building")
        state["assignment"] = {
            "id": secrets.token_hex(32), "task_key": task["key"], "branch": safe_branch(task),
            "requirements_sha256": hashlib.sha256(task_section(task).encode()).hexdigest(),
        }
        record_task_event(state, "partial", assignment=state["assignment"])
        push_history(state, "building")
        save_json(STATE_FILE, state)
    errors = assignment_errors(state)
    if errors:
        raise RuntimeError("; ".join(errors))
    # A prior handoff may belong to another task or an interrupted fix. Never
    # consume it implicitly; the resumed builder must read back and publish it.
    HANDOFF_FILE.unlink(missing_ok=True)
    prompt = build_cursor_prompt(task=task, task_section=task_section(task), state=state, mode=mode)
    result = run(builder_command(prompt), timeout=None)
    if load_json(STATE_FILE) != state:
        save_json(STATE_FILE, state)
        raise RuntimeError("builder modified supervisor state; original assignment restored")
    if result.returncode:
        state["last_error"] = f"Cursor failed ({result.returncode}): {result.stderr[-1000:]}"
        save_json(STATE_FILE, state)
        return
    try:
        handoff = load_json(HANDOFF_FILE)
        pr_url = handoff.get("current_pr_url")
        if not isinstance(pr_url, str) or not pr_url:
            raise ValueError("builder returned no PR URL")
        pr = pr_snapshot(pr_url)
        accepted = accept_handoff(state, handoff, task, pr)
    except (ValueError, OSError, AttributeError) as exc:
        state["last_error"] = f"Builder handoff invalid: {exc}"
        save_json(STATE_FILE, state)
        return
    push_history(accepted, "in_review")
    save_json(STATE_FILE, accepted)
    log(f"verified Cursor handoff: PR #{pr['number']} at {pr['headRefOid']}")


def review_prompt(state: dict[str, Any], pr: dict[str, Any]) -> str:
    task = next(item for item in load_json(QUEUE_FILE) if item["key"] == state["current_task_key"])
    return f"""Review PR #{pr['number']} for task {task['key']} at exact HEAD {pr['headRefOid']}.

Task context:
{task_section(task)}

Review the committed immutable diff `{pr['baseRefOid']}...{pr['headRefOid']}`. The supervisor has already materialized and verified both exact SHA objects locally. Do not substitute branch names. Inspect repository files and run read-only commands as needed. Check acceptance criteria, correctness, edge cases, security, tests, error handling, i18n/RTL/accessibility, migration compatibility, and scope discipline.

Return ONLY JSON matching the supplied schema. Copy these values exactly:
- schema_version: 1
- task_key: {task['key']}
- pr_number: {pr['number']}
- reviewed_head_sha: {pr['headRefOid']}

Decision rules:
- approve only if there are no critical or major issues.
- request_changes if any critical or major issue exists.
- Minor findings may accompany approve.
- Every issue needs severity, file, line (0 if not line-specific), description, and specific suggestion.
"""


def review_snapshot_errors(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if before.get("headRefOid") != after.get("headRefOid"):
        errors.append("PR HEAD changed during review")
    if before.get("baseRefOid") != after.get("baseRefOid"):
        errors.append("PR base changed during review")
    if after.get("state") != "OPEN" or after.get("isDraft"):
        errors.append("PR is no longer ready for review")
    return errors


def handle_review() -> None:
    state = load_json(STATE_FILE)
    pr = pr_snapshot(state["current_pr_url"])
    task = next(
        item for item in load_json(QUEUE_FILE) if item["key"] == state["current_task_key"]
    )
    handoff_errors = validate_builder_handoff(state, pr, expected_task=task)
    if handoff_errors:
        state["last_error"] = "Pre-review handoff invalid: " + "; ".join(handoff_errors)
        save_json(STATE_FILE, state)
        return
    actor = github_actor()
    nonce = state.get("review_nonce")
    if not nonce:
        nonce = secrets.token_hex(32)
        state["review_nonce"] = nonce
        save_json(STATE_FILE, state)
    existing, existing_comment = find_verified_review(
        state,
        pr,
        comments_snapshot(state["current_pr_url"]),
        expected_actor=actor,
        nonce=nonce,
    )
    if existing and existing_comment:
        save_json(
            STATE_FILE,
            apply_verified_review(
                state, existing, existing_comment, expected_actor=actor
            ),
        )
        log(f"recovered durable Codex review: {existing['decision']} for {existing['reviewed_head_sha']}")
        return
    materialize_review_commits(pr)
    with tempfile.TemporaryDirectory(prefix="barghsa-review-") as directory:
        root = Path(directory)
        prompt_path = root / "prompt.txt"
        output_path = root / "review.json"
        prompt_path.write_text(review_prompt(state, pr))
        command = reviewer_command(prompt_path, REVIEW_SCHEMA, output_path)
        result = subprocess.run(
            command,
            cwd=BASE,
            input=prompt_path.read_text(),
            text=True,
            capture_output=True,
            timeout=None,
        )
        if result.returncode or not output_path.exists():
            state["last_error"] = f"Codex review failed ({result.returncode}): {result.stderr[-1000:]}"
            save_json(STATE_FILE, state)
            return
        artifact = load_json(output_path)
    current_pr = pr_snapshot(state["current_pr_url"])
    snapshot_errors = review_snapshot_errors(pr, current_pr)
    if snapshot_errors:
        state["last_error"] = "Review invalidated: " + "; ".join(snapshot_errors)
        save_json(STATE_FILE, state)
        return
    errors = validate_review_artifact(
        artifact,
        expected_task_key=state["current_task_key"],
        expected_pr_number=pr["number"],
        expected_head_sha=pr["headRefOid"],
    )
    if errors:
        state["last_error"] = "Invalid Codex review: " + "; ".join(errors)
        save_json(STATE_FILE, state)
        return
    body = review_comment_body(artifact, nonce)
    run(["gh", "pr", "comment", state["current_pr_url"], "--body", body], timeout=60, check=True)
    comments = comments_snapshot(state["current_pr_url"])
    posted, comment = find_verified_review(
        state, pr, comments, expected_actor=actor, nonce=nonce
    )
    if posted != artifact or not comment:
        state["last_error"] = "Codex review comment could not be read back exactly"
        save_json(STATE_FILE, state)
        return
    save_json(
        STATE_FILE,
        apply_verified_review(state, artifact, comment, expected_actor=actor),
    )
    log(f"verified durable Codex review: {artifact['decision']} for {artifact['reviewed_head_sha']}")


def invalidate_approval_for_new_head(
    state: dict[str, Any], new_head_sha: str
) -> dict[str, Any]:
    state["status"] = "in_review"
    state["current_head_sha"] = new_head_sha
    state["review"] = None
    state["reviewed_head_sha"] = ""
    state["review_comment_id"] = None
    state["review_comment_url"] = ""
    state["review_comment_author"] = ""
    state["review_artifact_sha256"] = ""
    state["review_nonce"] = ""
    state["last_error"] = "Approval invalidated because the PR HEAD changed"
    push_history(state, "in_review")
    return state


def merge_command(pr_url: str, reviewed_head_sha: str) -> list[str]:
    return [
        "gh",
        "pr",
        "merge",
        pr_url,
        "--squash",
        "--match-head-commit",
        reviewed_head_sha,
    ]


def finalize_merged_state(state: dict[str, Any]) -> None:
    task_key = state["current_task_key"]
    record_task_event(state, "merged", pr_url=state["current_pr_url"], head_sha=state["reviewed_head_sha"])
    state["assignment"] = None
    completed = state.setdefault("build_completed_tasks", [])
    if task_key not in completed:
        completed.append(task_key)
    for key, value in {
        "status": "idle",
        "current_task_key": "",
        "current_task_id": "",
        "current_task_file": "",
        "current_branch": "",
        "current_pr_number": None,
        "current_pr_url": "",
        "current_head_sha": "",
        "validation_results": [],
        "review": None,
        "reviewed_head_sha": "",
        "review_comment_id": None,
        "review_comment_url": "",
        "review_comment_author": "",
        "review_artifact_sha256": "",
        "review_nonce": "",
        "fix_attempts": 0,
        "last_error": "",
    }.items():
        state[key] = value
    push_history(state, "idle", task_key)
    save_json(STATE_FILE, state)
    log(f"verified merge and completed {task_key}")


def handle_merge() -> None:
    state = load_json(STATE_FILE)
    pr = pr_snapshot(state["current_pr_url"])
    if pr.get("headRefOid") != state.get("reviewed_head_sha"):
        save_json(
            STATE_FILE,
            invalidate_approval_for_new_head(state, pr.get("headRefOid", "")),
        )
        return
    actor = github_actor()
    artifact, comment = find_verified_review(
        state,
        pr,
        comments_snapshot(state["current_pr_url"]),
        expected_actor=actor,
        nonce=state.get("review_nonce"),
    )
    binding_errors = (
        review_binding_errors(state, comment, artifact)
        if comment and artifact
        else ["approved review comment missing"]
    )
    if binding_errors:
        state["last_error"] = "approved review binding changed: " + "; ".join(binding_errors)
        save_json(STATE_FILE, state)
        return
    if pr.get("state") == "MERGED":
        errors = already_merged_finalization_errors(state, pr, artifact)
        if errors:
            state["last_error"] = "Merged-state recovery blocked: " + "; ".join(errors)
            save_json(STATE_FILE, state)
            return
        finalize_merged_state(state)
        return
    if pr.get("headRefOid") != state.get("reviewed_head_sha"):
        save_json(
            STATE_FILE,
            invalidate_approval_for_new_head(state, pr.get("headRefOid", "")),
        )
        return
    errors = merge_gate_errors(state, pr, artifact)
    if errors:
        state["last_error"] = "Merge gate blocked: " + "; ".join(errors)
        save_json(STATE_FILE, state)
        return
    # Do not request local branch deletion here: loop-state.json is intentionally
    # dirty runtime state, and local cleanup must not turn a successful remote
    # merge into a command failure.
    merge_result = run(
        merge_command(state["current_pr_url"], state["reviewed_head_sha"]),
        timeout=120,
    )
    merged = pr_snapshot(state["current_pr_url"])
    if merged.get("state") != "MERGED":
        state["last_error"] = (
            f"merge failed ({merge_result.returncode}); PR state is {merged.get('state')}: "
            f"{merge_result.stderr[-1000:]}"
        )
        save_json(STATE_FILE, state)
        return
    post_artifact, post_comment = find_verified_review(
        state,
        merged,
        comments_snapshot(state["current_pr_url"]),
        expected_actor=actor,
        nonce=state.get("review_nonce"),
    )
    post_merge_errors = already_merged_finalization_errors(state, merged, post_artifact)
    if post_comment and post_artifact:
        post_merge_errors.extend(review_binding_errors(state, post_comment, post_artifact))
    else:
        post_merge_errors.append("durable review binding missing after merge")
    if post_merge_errors:
        state["last_error"] = "Post-merge verification failed: " + "; ".join(post_merge_errors)
        save_json(STATE_FILE, state)
        return
    finalize_merged_state(state)


def validate_backlog() -> bool:
    result = run([sys.executable, "kanban/scripts/build_backlog.py", "--check"], timeout=60)
    if result.returncode == 0:
        return True
    state = load_json(STATE_FILE)
    state["status"] = "blocked"
    state["last_error"] = "Backlog validation failed: " + (result.stdout + result.stderr)[-2000:]
    push_history(state, "blocked")
    save_json(STATE_FILE, state)
    return False


def tick() -> None:
    global STORE
    log("=== Barghsa ownership-separated loop tick ===")
    if not acquire_lock():
        log("lock exists; another tick owns the loop")
        return
    try:
        if STATE_DIR.resolve().is_relative_to(BASE.resolve()):
            raise RuntimeError("supervisor state must be outside the product checkout")
        remote = run(["git", "remote", "get-url", "origin"], check=True).stdout.strip()
        STORE = StateStore(STATE_DIR, remote)
        STORE.read()
        if not validate_backlog():
            return
        state = load_json(STATE_FILE)
        if state.get("current_task_key"):
            errors = assignment_errors(state)
            if errors:
                state["status"] = "blocked"
                state["last_error"] = "; ".join(errors)
                save_json(STATE_FILE, state)
                return
        action = action_for_status(state.get("status", "idle"))
        log(f"state={state.get('status')} action={action}")
        if action in {"cursor_build", "cursor_fix"}:
            handle_cursor()
        elif action == "codex_review":
            handle_review()
        elif action == "merge":
            handle_merge()
    finally:
        release_lock()


if __name__ == "__main__":
    try:
        tick()
    except Exception as exc:
        log(f"FATAL: {type(exc).__name__}: {exc}")
        try:
            state = load_json(STATE_FILE)
            state["last_error"] = f"Supervisor exception: {type(exc).__name__}: {exc}"
            save_json(STATE_FILE, state)
        finally:
            release_lock()
        raise
