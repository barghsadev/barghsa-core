"""Reconcile historical skips with explicit task-level acceptance evidence."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATUSES = {"acceptance_verified", "partial", "deferred", "blocked", "retired"}


def reconcile(skips: list[dict], closure: dict) -> list[dict]:
    reviewed = closure["reviewed_tasks"]
    reviewed_keys = [row["task_key"] for row in reviewed]
    pending_keys = closure["pending_task_keys"]
    skip_keys = [row["task_key"] for row in skips]
    if (len(reviewed_keys) != len(set(reviewed_keys))
            or len(pending_keys) != len(set(pending_keys))
            or len(skip_keys) != len(set(skip_keys))
            or set(reviewed_keys) & set(pending_keys)):
        raise ValueError("Ambiguous task identity in skip or acceptance records")
    by_key = {row["task_key"]: row for row in reviewed}
    result = []
    for skip in skips:
        key = skip["task_key"]
        if key not in by_key and key not in pending_keys:
            raise ValueError(f"Skipped task absent from acceptance population: {key}")
        evidence = by_key.get(key)
        status = evidence["status"] if evidence else "acceptance_pending"
        if evidence and status not in STATUSES:
            raise ValueError(f"Unknown acceptance status: {status}")
        result.append({
            "task_key": key,
            "title": skip["title"],
            "historical_skip_commit": skip["skip_commit"],
            "historical_assessment": skip["current_assessment"],
            "direct_merged_prs": skip["direct_merged_prs"],
            "acceptance_status": status,
            "reviewed_sha": evidence["reviewed_sha"] if evidence else None,
            "limitations": evidence.get("limitations", []) if evidence else [],
            "next_action": (
                "Preserve verified implementation; do not rebuild this task"
                if status == "acceptance_verified" else
                "Preserve retirement; do not dispatch" if status == "retired" else
                "Keep deferred pending its recorded decision" if status == "deferred" else
                "Resolve recorded blocker before implementation" if status == "blocked" else
                "Review current implementation against requirements; build only unmet remainder"
            ),
        })
    return result


def reports(root: Path = ROOT) -> tuple[str, str]:
    paths = ["audit/skipped-tasks.json", "audit/acceptance-closure.json"]
    source = [(root / path).read_bytes() for path in paths]
    rows = reconcile(json.loads(source[0]), json.loads(source[1]))
    verified = sum(row["acceptance_status"] == "acceptance_verified" for row in rows)
    document = {
        "schema_version": 1,
        "scope": "Historical skips reconciled with recorded acceptance; not a dispatch queue",
        "source_sha256": {path: hashlib.sha256(data).hexdigest() for path, data in zip(paths, source)},
        "historically_skipped": len(rows),
        "acceptance_verified": verified,
        "tasks": rows,
    }
    lines = ["# Current disposition of historically skipped tasks", "",
             f"{len(rows)} historical skips remain in the record. {verified} now have verified task-level acceptance.",
             "The rest have the statuses shown below. Pending acceptance does not mean no code exists.",
             "Review current requirements and preserve working implementation before planning any remaining build.",
             "This list does not authorize dispatch or resume the feature loop.", "",
             "Use [current canonical requirements](current-task-requirements.json) and "
             "[acceptance evidence](acceptance-closure.json). "
             "[Historical skip evidence](skipped-tasks.json) remains unchanged.", "",
             "| Qualified task | Title | Acceptance | Next action |",
             "| --- | --- | --- | --- |"]
    for row in rows:
        cells = [row["task_key"], row["title"], row["acceptance_status"], row["next_action"]]
        lines.append("| " + " | ".join(cell.replace("|", "\\|").replace("\n", " ") for cell in cells) + " |")
    return json.dumps(document, ensure_ascii=False, indent=2) + "\n", "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    outputs = reports()
    targets = [ROOT / "audit/current-skipped-tasks.json", ROOT / "audit/current-skipped-tasks.md"]
    for target, output in zip(targets, outputs):
        if args.write:
            temporary = target.with_suffix(target.suffix + ".tmp")
            temporary.write_text(output, encoding="utf-8")
            temporary.replace(target)
        elif not target.exists() or target.read_text(encoding="utf-8") != output:
            print("Current skipped-task report is stale; run with --write")
            return 1
    print("Validated current skipped-task dispositions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
