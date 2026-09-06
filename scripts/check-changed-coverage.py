#!/usr/bin/env python3
"""Enforce coverage for changed source, grouped by package and criticality."""

import argparse
import json
from pathlib import Path
import re
import subprocess

CRITICAL = re.compile(r"(?:^|[/_.-])(auth(?:entication|orization)?|authz|admin|staff|role[s]?|verification|rate-limit|finance|financial|order[s]?|session|csrf|otp|permission[s]?|payment[s]?|wallet|refund[s]?|pricing|price[s]?|contract[s]?|state-machine|invoice[s]?|dual-approval)(?:[/_.-]|$)")
SOURCE = re.compile(r"^(apps|packages)/[^/]+/src/.+\.(?:[cm]?[jt]s|[jt]sx)$")


def eligible(path):
    parts = Path(path).parts
    return bool(SOURCE.match(path)) and not (
        any(part in ("test", "__tests__", "generated") for part in parts)
        or re.search(r"\.(test|spec|d)\.[cm]?[jt]sx?$", path)
    )


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True)


def changes(root, base):
    # Resolve untrusted refs to an immutable object before using them in diff commands.
    base_sha = git(root, "rev-parse", "--verify", "--end-of-options", f"{base}^{{commit}}").strip()
    ancestor = git(root, "merge-base", base_sha, "HEAD").strip()
    names = git(root, "diff", "--name-only", "--no-renames", "-z", ancestor, "HEAD", "--").split("\0")
    result = {}
    for path in names:
        if not eligible(path) or not (root / path).is_file():
            continue
        diff = git(root, "diff", "--no-ext-diff", "--no-renames", "--unified=0", ancestor, "HEAD", "--", path)
        lines = set()
        for start, count in re.findall(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", diff, re.MULTILINE):
            lines.update(range(int(start), int(start) + (int(count) if count else 1)))
        if lines:
            result[path] = lines
    return ancestor, result


def count(value):
    if type(value) not in (int, float) or value < 0 or value != value or value == float("inf"):
        raise ValueError("invalid coverage hit count")
    return value


def line_number(location):
    line = location.get("start", {}).get("line")
    if type(line) is not int or line < 1:
        raise ValueError("invalid source location")
    return line


def metrics(coverage, changed, critical):
    for key in ("statementMap", "s", "branchMap", "b"):
        if not isinstance(coverage.get(key), dict):
            raise ValueError(f"missing coverage {key}")
    if coverage["statementMap"].keys() != coverage["s"].keys() or coverage["branchMap"].keys() != coverage["b"].keys():
        raise ValueError("coverage maps and counters disagree")
    # Istanbul line coverage uses each statement's starting line, taking max hits
    # where multiple statements share a line. Critical files use whole-file totals.
    lines = {}
    for key, location in coverage["statementMap"].items():
        line = line_number(location)
        hits = count(coverage["s"][key])
        if critical or line in changed:
            lines[line] = max(lines.get(line, 0), hits)
    branches = []
    for key, branch in coverage["branchMap"].items():
        hits = coverage["b"][key]
        locations = branch.get("locations")
        if not isinstance(hits, list) or not isinstance(locations, list) or len(hits) != len(locations):
            raise ValueError("invalid branch counters")
        location = branch.get("loc", {})
        start = line_number(location)
        end = location.get("end", {}).get("line", start)
        if type(end) is not int or end < start:
            raise ValueError("invalid branch extent")
        if critical or any(start <= line <= end for line in changed):
            branches.extend(count(hit) for hit in hits)
    return {"lines": len(lines), "covered_lines": sum(hit > 0 for hit in lines.values()),
            "branches": len(branches), "covered_branches": sum(hit > 0 for hit in branches)}


def evaluate(root, changed):
    groups = {}
    errors = []
    reports = {}
    for path, changed_lines in sorted(changed.items()):
        package = "/".join(path.split("/")[:2])
        critical = bool(CRITICAL.search(path))
        group = groups.setdefault((package, critical), {"package": package, "critical": critical, "files": [], "lines": 0, "covered_lines": 0, "branches": 0, "covered_branches": 0})
        group["files"].append(path)
        try:
            if package not in reports:
                document = json.loads((root / package / "coverage/coverage-final.json").read_text())
                if not isinstance(document, dict):
                    raise ValueError("invalid coverage document")
                reports[package] = {str((root / key).resolve()): value for key, value in document.items()}
            document = reports[package]
            coverage = document.get(str((root / path).resolve())) or document.get(path)
            if not isinstance(coverage, dict):
                raise ValueError("source missing from package coverage report")
            for key, value in metrics(coverage, changed_lines, critical).items():
                group[key] += value
        except (OSError, ValueError, TypeError, AttributeError) as error:
            errors.append({"file": path, "reason": str(error)})
    for group in groups.values():
        group["required_lines"] = 90 if group["critical"] else 80
        group["required_branches"] = 85 if group["critical"] else 75
        group["passed"] = not any(error["file"] in group["files"] for error in errors) and all(group[f"covered_{kind}"] * 100 >= group[kind] * group[f"required_{kind}"] for kind in ("lines", "branches"))
    return {"schema_version": 1, "status": "failed" if errors or any(not g["passed"] for g in groups.values()) else "passed", "groups": list(groups.values()), "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    try:
        ancestor, changed = changes(root, args.base)
        report = evaluate(root, changed)
        report.update(base_sha=ancestor, head_sha=git(root, "rev-parse", "HEAD").strip())
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        report = {"schema_version": 1, "status": "failed", "errors": [{"reason": str(error)}]}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
