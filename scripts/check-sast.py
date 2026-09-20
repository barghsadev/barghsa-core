#!/usr/bin/env python3
"""Run local Semgrep rules and retain findings without source or credential snippets."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

VERSION = "1.176.1"
ROOT = Path(__file__).resolve().parent.parent
TARGETS = [
    "apps/api/src", "apps/web/src", "packages/db/src", "packages/shared/src", "packages/ui/src",
    "packages/i18n/src", "apps/web/server.js", "apps/api/healthcheck.js",
]


def safe_report(raw: dict, exit_code: int) -> dict:
    return {
        "scanner": f"semgrep {VERSION}",
        "exit_code": exit_code,
        "scanned_files": raw.get("paths", {}).get("scanned", []),
        "findings": [
            {
                "rule": item["check_id"],
                "file": item["path"],
                "line": item["start"]["line"],
                "severity": item.get("extra", {}).get("severity"),
            }
            for item in raw.get("results", [])
        ],
        # Parser messages and dataflow traces can contain source. Retain location/type only.
        "errors": [
            {"code": item.get("code"), "file": item.get("path"), "level": item.get("level")}
            for item in raw.get("errors", [])
        ],
    }


def report_exit_code(report: dict) -> int:
    if report["exit_code"] != 0:
        return report["exit_code"]
    if report["findings"] or report["errors"] or not report["scanned_files"]:
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    env = {**os.environ, "SEMGREP_SEND_METRICS": "off", "SEMGREP_ENABLE_VERSION_CHECK": "0"}
    version = subprocess.check_output(["semgrep", "--version"], env=env, text=True).strip()
    if version != VERSION:
        raise RuntimeError(f"Expected Semgrep {VERSION}; found {version}")
    tests = subprocess.run(
        ["semgrep", "--test", "--config", ".semgrep/security.yml", ".semgrep/security.tsx"],
        cwd=ROOT, env=env, capture_output=True, text=True, check=True,
    )
    if "5/5" not in tests.stdout:
        raise RuntimeError("Expected all five security rule fixtures to run and pass")
    print("All five security rule fixtures passed", flush=True)
    with tempfile.TemporaryDirectory(prefix="barghsa-sast-") as directory:
        raw_path = Path(directory) / "raw.json"
        result = subprocess.run(
            [
                "semgrep", "scan", "--config", ".semgrep/security.yml",
                "--metrics=off", "--disable-version-check", "--strict", "--error",
                "--exclude", "*.test.ts", "--exclude", "*.spec.ts",
                "--json", "--output", str(raw_path), *TARGETS,
            ],
            cwd=ROOT, env=env, capture_output=True, text=True, check=False,
        )
        if not raw_path.exists():
            raise RuntimeError(f"Semgrep exited {result.returncode} without a scan report")
        report = safe_report(json.loads(raw_path.read_text()), result.returncode)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
        print(
            f"Scanned {len(report['scanned_files'])} files; "
            f"{len(report['findings'])} findings; {len(report['errors'])} scanner errors",
            flush=True,
        )
        return report_exit_code(report)


if __name__ == "__main__":
    raise SystemExit(main())
