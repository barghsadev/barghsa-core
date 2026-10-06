"""Read original epic task specifications. This module owns no task status."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import re
ROOT = Path(__file__).resolve().parents[2]
EPICS_DIR = ROOT / 'kanban/epics'
COMPLEXITIES = {'XS', 'S', 'M', 'L', 'XL'}
TASK_ID_RE = re.compile(r'T-[0-9]+(?:\.[0-9]+){2,4}')
HEADING_RE = re.compile(r'^(#{1,6})\s+(.+?)\s*$')
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


def task_context(task: dict[str, Any], epics_dir: Path = EPICS_DIR) -> str:
    """Extract any supported task format together with its story requirements."""
    fname = task["fname"]
    if Path(fname).name != fname or task["key"] != f"{fname}#{task['id']}":
        raise ValueError("invalid qualified task identity")
    lines = (epics_dir / fname).read_text(encoding="utf-8").splitlines()
    starts = task_starts(lines)
    matches = [i for i, (_, task_id, _) in enumerate(starts) if task_id == task["id"]]
    if len(matches) != 1:
        raise ValueError(f"expected one task section: {task['key']}")
    position = matches[0]
    start = starts[position][0]
    end = starts[position + 1][0] if position + 1 < len(starts) else len(lines)
    # A following story's introduction is not part of this task.
    for i in range(start + 1, end):
        heading = HEADING_RE.match(lines[i])
        if heading and (len(heading.group(1)) <= 3 or re.match(r"S-\d", heading.group(2))):
            end = i
            break
    story = 0
    for i in range(start):
        heading = HEADING_RE.match(lines[i])
        if heading and (len(heading.group(1)) <= 3 or re.match(r"S-\d", heading.group(2))):
            story = i
    first_sibling = next((i for i, _, _ in starts if story <= i <= start), start)
    intro = "\n".join(lines[story:first_sibling]).strip()
    body = "\n".join(lines[start:end]).strip()
    return "\n\n".join(part for part in (intro, body) if part)
