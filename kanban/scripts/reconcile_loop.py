#!/usr/bin/env python3
"""Prepare a blocked, evidence-backed replacement for legacy completion claims.

By default this only writes a reviewable local artifact. --publish bootstraps the
dedicated remote state branch and deliberately leaves the scheduler blocked.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

from build_backlog import ROOT, parse_all_tasks, queue_tasks, validate_queue, QUEUE_PATH
from loop_state import StateStore, atomic_json


def reconciled_state(register: dict, review: dict, legacy: dict, queue: list[dict]) -> dict:
    keys = {task["key"] for task in queue}
    assessments = {task["task_key"]: task for task in review["tasks"]}
    evidence = {task["task_key"]: task for task in register["tasks"]}
    completed, events = [], []
    for task in queue:
        key = task["key"]
        assessment = assessments.get(key)
        if not assessment:
            continue
        prs = evidence.get(key, {}).get("prs", [])
        if prs:
            completed.append(key)
            events.append({"task_key": key, "disposition": "merged", "prs": prs})
        events.append({
            "task_key": key,
            "disposition": "deferred" if assessment.get("historically_skipped") and not prs else "partial",
            "legacy_claimed_complete": assessment.get("claimed_complete_in_state", False),
            "reason": assessment["assessment"], "repair_groups": assessment["repair_groups"],
            "acceptance_groups": assessment["acceptance_groups"], "audit_head": review["head"],
        })
    for key in dict.fromkeys(legacy.get("build_completed_tasks", [])):
        if key not in keys:
            events.append({"task_key": key, "disposition": "retired", "legacy_claimed_complete": True,
                           "reason": "Identity absent from current canonical epics; retained for history"})
        elif key not in assessments:
            raise ValueError(f"legacy completion has no audit disposition: {key}")
    return {
        "schema_version": 2, "status": "blocked", "assignment": None,
        "current_task_key": "", "current_task_id": "", "current_task_file": "", "current_branch": "",
        "current_pr_number": None, "current_pr_url": "", "current_head_sha": "", "fix_attempts": 0,
        "build_completed_tasks": completed, "task_events": events, "status_history": [],
        "last_error": "Repair acceptance is incomplete. Inspect open PR #304 and finish audit closure before explicit recovery.",
        "reconciliation": {"audit_head": review["head"], "legacy_entry_count": len(legacy.get("build_completed_tasks", [])),
                           "merged_task_count": len(completed), "acceptance_verified_count": 0},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "audit/reconciled-loop-state.json")
    parser.add_argument("--publish", action="store_true", help="bootstrap the remote state branch in blocked status")
    args = parser.parse_args()
    load = lambda path: json.loads(path.read_text())
    queue = load(QUEUE_PATH)
    validate_queue(queue, queue_tasks(parse_all_tasks()))
    state = reconciled_state(load(ROOT / "audit/merged-task-register.json"),
                             load(ROOT / "audit/task-review.json"), load(ROOT / "kanban/loop-state.json"), queue)
    if args.publish:
        directory = Path(os.environ.get("BARGHSA_LOOP_STATE_DIR", str(Path.home() / ".local/state/barghsa-loop")))
        if directory.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError("runtime state must be outside the checkout")
        remote = subprocess.check_output(["git", "remote", "get-url", "origin"], cwd=ROOT, text=True).strip()
        store = StateStore(directory, remote)
        if store.remote_revision():
            raise ValueError("remote state already exists; bootstrap must not overwrite it")
        store.save(state, bootstrap=True)
    atomic_json(args.output, state)
    print(f"Recorded {len(state['build_completed_tasks'])} merged tasks, zero acceptance certifications; status blocked")


if __name__ == "__main__":
    main()
