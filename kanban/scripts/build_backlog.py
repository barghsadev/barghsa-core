#!/usr/bin/env python3
"""Build and validate Barghsa's executable backlog and source traceability.

The epic Markdown files are the canonical backlog. This script extracts every
concrete T-* task in document order, preserves its declared complexity, writes
`kanban/task-queue.json`, and creates a section-level traceability ledger for
README.md and architecture.md.

Usage:
    python3 kanban/scripts/build_backlog.py --write
    python3 kanban/scripts/build_backlog.py --check
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, cast

ROOT = Path(__file__).resolve().parents[2]
KANBAN = ROOT / "kanban"
EPICS_DIR = KANBAN / "epics"
QUEUE_PATH = KANBAN / "task-queue.json"
TRACE_PATH = KANBAN / "requirements-traceability.json"

COMPLEXITIES = {"XS", "S", "M", "L", "XL"}
TASK_ID_RE = re.compile(r"T-[0-9]+(?:\.[0-9]+){2,4}")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")

# Heading-based ownership is intentionally explicit. The source section is the
# traceability unit; concrete acceptance criteria remain in the owned tasks.
README_OWNER_RULES: list[tuple[re.Pattern[str], list[str]]] = [
    (re.compile(r"branding|ui and frontend|layout|dashboard|app$|profiles awaiting manual verify", re.I), ["07-ui-ux-design.md", "02-auth-users-admin.md"]),
    (re.compile(r"user base|authorization and data ownership|authentication|register|login|forget password|tos|onboarding|addresses|crm|agents management|profile and user settings|ticketing|admin features", re.I), ["02-auth-users-admin.md", "06-security-testing-observability.md", "07-ui-ux-design.md"]),
    (re.compile(r"documents templates|documents$|file storage", re.I), ["05-notifications-documents-ai.md", "06-security-testing-observability.md", "07-ui-ux-design.md"]),
    (re.compile(r"contracts|invoices|wallet", re.I), ["04-invoices-wallet-contracts.md", "07-ui-ux-design.md"]),
    (re.compile(r"power saving|products|saving plans|gift codes|consultation|solar power|electricity supply|simple order|advanced order|shared calculation|electricity contract|contract, invoice, and payment", re.I), ["03-core-business.md", "04-invoices-wallet-contracts.md", "07-ui-ux-design.md"]),
    (re.compile(r"notifications|delivery-provider|email provider|sms\.ir|provider failure", re.I), ["05-notifications-documents-ai.md", "06-security-testing-observability.md", "07-ui-ux-design.md"]),
    (re.compile(r"ai assistant safety", re.I), ["05-notifications-documents-ai.md", "06-security-testing-observability.md", "07-ui-ux-design.md"]),
    (re.compile(r"security|authentication and sessions|csrf|cors|authorization|input, output|rate limiting|files, providers|secrets|reliability|observability|performance engineering|cost controls|test strategy|unit tests|component and frontend|backend integration|e2e tests|non-functional tests|quality gates|pull request gate|main/staging gate|production promotion gate|scheduled quality gates|definition of done|product and ux|engineering|tests and quality|security and privacy|operations and release", re.I), ["06-security-testing-observability.md", "01-platform-infrastructure.md"]),
    (re.compile(r"architecture|deployment strategy|data and consistency|service objectives|backend|development|prerequisites|local setup|build$|architecture notes", re.I), ["01-platform-infrastructure.md", "06-security-testing-observability.md"]),
    (re.compile(r"docker.f(?:or|ile)|file.watch|polling", re.I), ["01-platform-infrastructure.md"]),
    (re.compile(r"domain boundaries", re.I), ["01-platform-infrastructure.md", "02-auth-users-admin.md", "03-core-business.md", "04-invoices-wallet-contracts.md", "05-notifications-documents-ai.md", "06-security-testing-observability.md"]),
    (re.compile(r"product-wide operating principles|no dead ends|state machines|atomicity|customer transparency|secure administration|configuration safety", re.I), ["03-core-business.md", "04-invoices-wallet-contracts.md", "05-notifications-documents-ai.md", "06-security-testing-observability.md", "07-ui-ux-design.md"]),
    (re.compile(r"intro|goals|product values|general rules", re.I), ["01-platform-infrastructure.md", "02-auth-users-admin.md", "03-core-business.md", "04-invoices-wallet-contracts.md", "05-notifications-documents-ai.md", "06-security-testing-observability.md", "07-ui-ux-design.md"]),
]

ARCH_OWNER_RULES: list[tuple[re.Pattern[str], list[str]]] = [
    (re.compile(r"barghsa technical architecture|decision priorities|system shape|sources of truth|data rules|deployment|cost policy|architecture decisions", re.I), ["01-platform-infrastructure.md", "06-security-testing-observability.md"]),
    (re.compile(r"domain modules", re.I), ["01-platform-infrastructure.md", "02-auth-users-admin.md", "03-core-business.md", "04-invoices-wallet-contracts.md", "05-notifications-documents-ai.md", "06-security-testing-observability.md"]),
    (re.compile(r"api and frontend", re.I), ["01-platform-infrastructure.md", "07-ui-ux-design.md"]),
    (re.compile(r"background processing|notification transports", re.I), ["01-platform-infrastructure.md", "05-notifications-documents-ai.md", "06-security-testing-observability.md"]),
    (re.compile(r"reliability targets|security|observability and operations|testing and quality", re.I), ["06-security-testing-observability.md", "01-platform-infrastructure.md"]),
]


@dataclass(frozen=True)
class Task:
    fname: str
    task_id: str
    title: str
    complexity: str
    line: int

    @property
    def key(self) -> str:
        return f"{self.fname}#{self.task_id}"

    def as_json(self) -> dict[str, object]:
        return {
            "key": self.key,
            "fname": self.fname,
            "id": self.task_id,
            "title": self.title,
            "complexity": self.complexity,
            "source_line": self.line,
        }


def clean_title(value: str) -> str:
    value = value.replace("\ufe0f", "")
    value = re.sub(r"^[📋⚠🔐🔧🔄📊🧩️\s]+", "", value)
    value = value.replace("**", "").strip()
    return re.sub(r"\s+", " ", value).strip(" |")


def parse_complexity(lines: list[str], start: int, end: int) -> str | None:
    chunk = "\n".join(lines[start:end])
    matches = re.findall(r"(?:\*\*Complexity:\*\*|Complexity:)\s*(XS|S|M|L|XL)\b", chunk)
    if matches:
        return matches[0]
    matches = re.findall(r"\|\s*(XS|S|M|L|XL)\s*\|\s*$", chunk, re.M)
    return matches[-1] if matches else None


def task_starts(lines: list[str]) -> list[tuple[int, str, str]]:
    starts: list[tuple[int, str, str]] = []
    for index, line in enumerate(lines):
        patterns = [
            # Bullet task: - **T-01.01.01:** Title
            re.compile(r"^\s*-\s+\*\*(T-[0-9]+(?:\.[0-9]+){2,4}):\*\*\s*(.+?)\s*$"),
            # Bold task heading: **T-01.01.01 — Title**
            re.compile(r"^\*\*(T-[0-9]+(?:\.[0-9]+){2,4})\s*[—:-]\s*(.+?)\*\*\s*$"),
            # Bold ID in a table.
            re.compile(r"^\|\s*\*\*(T-[0-9]+(?:\.[0-9]+){2,4})(?:\s*[—:-]\s*(.*?))?\*\*\s*\|\s*(.*?)\s*(?:\|.*)?$"),
            # Plain ID in a table.
            re.compile(r"^\|\s*(T-[0-9]+(?:\.[0-9]+){2,4})\s*\|\s*(.*?)\s*(?:\|.*)?$"),
        ]
        for pattern in patterns:
            match = pattern.match(line)
            if match:
                groups = match.groups()
                # Epic 05 stores the title next to the ID inside the first
                # bold table cell; other table formats put it in cell two.
                title = next((value for value in groups[1:] if value), "")
                starts.append((index, match.group(1), clean_title(title)))
                break
    return starts


def parse_epic(path: Path) -> list[Task]:
    lines = path.read_text(encoding="utf-8").splitlines()
    starts = task_starts(lines)
    tasks: list[Task] = []
    for position, (index, task_id, title) in enumerate(starts):
        end = starts[position + 1][0] if position + 1 < len(starts) else min(len(lines), index + 30)
        complexity = parse_complexity(lines, index, end)
        if not complexity:
            row_complexities = re.findall(r"\|\s*(XS|S|M|L|XL)\s*\|", lines[index])
            complexity = row_complexities[0] if row_complexities else None
        if not complexity:
            raise ValueError(f"{path.name}:{index + 1}: task {task_id} has no declared complexity")
        if not title:
            raise ValueError(f"{path.name}:{index + 1}: task {task_id} has no title")
        tasks.append(Task(path.name, task_id, title, complexity, index + 1))
    return tasks


def parse_all_tasks() -> list[Task]:
    tasks: list[Task] = []
    for path in sorted(EPICS_DIR.glob("*.md")):
        tasks.extend(parse_epic(path))
    keys = [task.key for task in tasks]
    duplicates = sorted(key for key in set(keys) if keys.count(key) > 1)
    if duplicates:
        raise ValueError(f"duplicate task keys: {duplicates[:10]}")
    return tasks


def section_entries(source: Path, rules: list[tuple[re.Pattern[str], list[str]]], prefix: str) -> list[dict[str, object]]:
    lines = source.read_text(encoding="utf-8").splitlines()
    headings: list[tuple[int, int, str]] = []
    for index, line in enumerate(lines, start=1):
        match = HEADING_RE.match(line)
        if match:
            headings.append((index, len(match.group(1)), match.group(2).strip()))
    entries: list[dict[str, object]] = []
    for number, (start, level, heading) in enumerate(headings, start=1):
        end = len(lines)
        for next_start, next_level, _ in headings[number:]:
            if next_level <= level:
                end = next_start - 1
                break
        owners: list[str] | None = None
        for pattern, candidates in rules:
            if pattern.search(heading):
                owners = candidates
                break
        if owners is None:
            raise ValueError(f"no ownership rule for {source.name}:{start} heading {heading!r}")
        entries.append({
            "requirement_id": f"{prefix}-{number:03d}",
            "source": source.name,
            "start_line": start,
            "end_line": end,
            "heading": heading,
            "owner_files": owners,
            "status": "covered",
        })
    return entries


def build_traceability(tasks: list[Task]) -> dict[str, Any]:
    by_file = {path.name: 0 for path in EPICS_DIR.glob("*.md")}
    keys_by_file: dict[str, list[str]] = {path.name: [] for path in EPICS_DIR.glob("*.md")}
    for task in tasks:
        by_file[task.fname] = by_file.get(task.fname, 0) + 1
        keys_by_file.setdefault(task.fname, []).append(task.key)
    entries = section_entries(ROOT / "README.md", README_OWNER_RULES, "README")
    entries += section_entries(ROOT / "architecture.md", ARCH_OWNER_RULES, "ARCH")
    for entry in entries:
        missing = [fname for fname in entry["owner_files"] if by_file.get(fname, 0) == 0]
        if missing:
            raise ValueError(f"{entry['requirement_id']} has owner files with no tasks: {missing}")
        entry["owner_task_counts"] = {fname: by_file[fname] for fname in entry["owner_files"]}
        owner_files = cast(list[str], entry["owner_files"])
        entry["owner_task_keys"] = {
            fname: keys_by_file[fname]
            for fname in owner_files
        }
    return {
        "schema_version": 1,
        "coverage_unit": "source heading section",
        "sources": ["README.md", "architecture.md"],
        "entries": entries,
    }


def validate_source_coverage(trace: dict[str, Any]) -> None:
    for source_name in trace["sources"]:
        path = ROOT / source_name
        line_count = len(path.read_text(encoding="utf-8").splitlines())
        entries = [entry for entry in trace["entries"] if entry["source"] == source_name]
        covered: set[int] = set()
        for entry in entries:
            if entry["status"] != "covered":
                raise ValueError(f"{entry['requirement_id']} is not covered")
            covered.update(range(int(entry["start_line"]), int(entry["end_line"]) + 1))
        # Content before the first H1 is impossible in these sources; every line
        # from the first heading through EOF must belong to a section.
        first = min(int(entry["start_line"]) for entry in entries)
        missing = [line for line in range(first, line_count + 1) if line not in covered]
        if missing:
            raise ValueError(f"{source_name} has untraced lines: {missing[:20]}")


def validate_repository(tasks: list[Task], trace: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    all_ids = {task.task_id for task in tasks}
    all_text = "\n".join(path.read_text(encoding="utf-8") for path in sorted(EPICS_DIR.glob("*.md")))

    if "## Gap Remediation" in all_text:
        errors.append("stale Gap Remediation section remains")
    if re.search(r"\b[ND A]\d+\.\d+\s*[—-]", all_text):
        errors.append("legacy non-T work-item identifier remains")
    if "T-06.08.03.44" in all_text:
        errors.append("known task typo T-06.08.03.44 remains")
    for phantom in ("T-10.02.01", "T-10.03.01"):
        if phantom in all_text:
            errors.append(f"phantom dependency remains: {phantom}")
    if re.search(r"Status:\*\*\s*(?:⏳\s*)?Being drafted|Status:\*\*\s*🚧\s*Planned", all_text, re.I):
        errors.append("draft/planned status marker remains")
    if "MUI or React Aria" in all_text or "from MUI or React Aria" in all_text:
        errors.append("ambiguous Base UI implementation remains")

    # All concrete T references must resolve somewhere in the canonical backlog.
    references = set(TASK_ID_RE.findall(all_text))
    unresolved = sorted(references - all_ids)
    if unresolved:
        errors.append(f"unresolved task references: {unresolved[:20]}")

    try:
        validate_source_coverage(trace)
    except ValueError as exc:
        errors.append(str(exc))
    return errors


def serialized_queue(tasks: Iterable[Task]) -> str:
    return json.dumps([task.as_json() for task in tasks], ensure_ascii=False, indent=2) + "\n"


def serialized_trace(trace: dict[str, Any]) -> str:
    return json.dumps(trace, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()

    try:
        tasks = parse_all_tasks()
        trace = build_traceability(tasks)
        errors = validate_repository(tasks, trace)
        if errors:
            raise ValueError("; ".join(errors))
        queue_text = serialized_queue(tasks)
        trace_text = serialized_trace(trace)
        if args.write:
            QUEUE_PATH.write_text(queue_text, encoding="utf-8")
            TRACE_PATH.write_text(trace_text, encoding="utf-8")
            print(f"wrote {len(tasks)} tasks and {len(trace['entries'])} traceability entries")
        else:
            if not QUEUE_PATH.exists():
                raise ValueError("task-queue.json is missing; run --write")
            on_disk = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
            canonical = json.loads(queue_text)
            # Accept reordered queues: compare by sorted task-key identity.
            if sorted(t["key"] for t in on_disk) != sorted(t["key"] for t in canonical):
                raise ValueError("task-queue.json has different tasks than the backlog; run --write")
            if len(on_disk) != len(canonical):
                raise ValueError("task-queue.json has wrong task count; run --write")
            if not TRACE_PATH.exists() or TRACE_PATH.read_text(encoding="utf-8") != trace_text:
                raise ValueError("requirements-traceability.json is stale; run --write")
            print(f"validated {len(tasks)} tasks and {len(trace['entries'])} traceability entries")
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"backlog validation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
