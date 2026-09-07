"""Bind the historical audit population to current canonical task requirements.

This overlay never changes completion, acceptance, PR provenance or loop state.
The original task-review.json remains the historical baseline.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "kanban" / "scripts"))
from build_backlog import parse_epic, task_context  # noqa: E402


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def requirement_record(task: dict, root: Path = ROOT) -> dict:
    source = root / "kanban" / "epics" / task["fname"]
    context = task_context(task, source.parent)
    # Use the canonical parser's line, never an old audit's saved source line.
    matches = [item for item in parse_epic(source) if item.key == task["key"]]
    if len(matches) != 1:
        raise ValueError(f"Expected one canonical task: {task['key']}")
    current = matches[0]
    task_line = source.read_text(encoding="utf-8").splitlines()[current.line - 1]
    intro, separator, body = context.partition(task_line)
    if not separator:
        raise ValueError(f"Task body absent from context: {task['key']}")
    return {
        "task_key": current.key,
        "requirement_file": f"kanban/epics/{current.fname}",
        "requirement_line": current.line,
        "story_context": intro.strip(),
        "requirement_extract": (separator + body).strip(),
        "context_sha256": digest(context),
    }


def build_register(root: Path = ROOT) -> dict:
    baseline_text = (root / "audit/task-review.json").read_text(encoding="utf-8")
    baseline = json.loads(baseline_text)
    keys = [item["task_key"] for item in baseline["tasks"]]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate task identities in baseline audit")
    records = []
    files = {}
    for key in keys:
        fname, task_id = key.split("#")
        record = requirement_record({"key": key, "fname": fname, "id": task_id}, root)
        records.append(record)
        path = record["requirement_file"]
        files[path] = digest((root / path).read_text(encoding="utf-8"))
    return {
        "schema_version": 1,
        "scope": "Current requirements for every historical audit task; not acceptance certification",
        "baseline_register": "audit/task-review.json",
        "baseline_register_sha256": digest(baseline_text),
        "source_sha256": files,
        "tasks": records,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    target = ROOT / "audit/current-task-requirements.json"
    output = json.dumps(build_register(), ensure_ascii=False, indent=2) + "\n"
    if args.write:
        temporary = target.with_suffix(".json.tmp")
        temporary.write_text(output, encoding="utf-8")
        temporary.replace(target)
    elif not target.exists() or target.read_text(encoding="utf-8") != output:
        print("Current audit requirements are stale; run with --write", file=sys.stderr)
        return 1
    print(f"Validated {len(json.loads(output)['tasks'])} current task requirement bindings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
