#!/usr/bin/env python3
"""Render a saved admin policy for the existing monitoring Compose services."""
import argparse
import hashlib
import json
from pathlib import Path


BOUNDS = {
    "searchableLogsDays": (30, 365),
    "metricsArchiveDays": (400, 730),
    "ordinaryTracesDays": (7, 90),
    "priorityTracesDays": (30, 365),
}
TEMPLATES = (
    ("operator-loki.yml", "  retention_period: 720h", 1, "searchableLogsDays", 720),
    ("operator-tempo.yml", "block_retention: 168h", 2, "ordinaryTracesDays", 168),
    ("operator-tempo-overrides.yml", "block_retention: 720h", 1, "priorityTracesDays", 720),
)


def render(snapshot, templates):
    if not isinstance(snapshot, dict) or set(snapshot) != {"version", "policy", "canEdit"}:
        raise ValueError("Use the saved admin policy response")
    version, policy = snapshot["version"], snapshot["policy"]
    if (type(version) is not int or not 0 <= version <= 2147483647
            or type(snapshot["canEdit"]) is not bool
            or not isinstance(policy, dict) or set(policy) != set(BOUNDS)
            or any(type(policy[key]) is not int or not low <= policy[key] <= high
                   for key, (low, high) in BOUNDS.items())
            or policy["ordinaryTracesDays"] > policy["priorityTracesDays"]):
        raise ValueError("Invalid operational retention policy")
    files = {}
    for name, marker, count, key, default in TEMPLATES:
        source = (templates / name).read_text()
        if source.count(marker) != count:
            raise ValueError(f"Unexpected retention configuration in {name}")
        files[name] = source.replace(marker, marker.replace(f"{default}h", f"{policy[key] * 24}h"))
    files["metrics-retention.env"] = (
        f"BARGHSA_METRICS_ARCHIVE_RETENTION={policy['metricsArchiveDays']}d\n"
    )
    files["policy.json"] = json.dumps({
        "version": version,
        "policy": policy,
        "sha256": {name: hashlib.sha256(value.encode()).hexdigest() for name, value in files.items()},
    }, indent=2) + "\n"
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path, help="Saved GET response from the authorized admin API")
    parser.add_argument("output", type=Path, help="New directory under a protected operator path")
    args = parser.parse_args()
    try:
        files = render(json.loads(args.snapshot.read_text()), Path(__file__).resolve().parent)
        args.output.mkdir(mode=0o700)
        for name, content in files.items():
            (args.output / name).write_text(content)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Retention policy was not prepared: {error}\n")


if __name__ == "__main__":
    main()
