#!/usr/bin/env python3
"""Scan Git history with a checksum-pinned Gitleaks release and redacted output."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import secrets
import subprocess
import tarfile
import tempfile
import urllib.request

VERSION = "8.30.1"
ARCHIVES = {
    ("Linux", "x86_64"): (
        "linux_x64",
        "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    ),
    ("Darwin", "arm64"): (
        "darwin_arm64",
        "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
    ),
}


def install(folder: Path) -> Path:
    target, checksum = ARCHIVES[(platform.system(), platform.machine())]
    url = (
        f"https://github.com/gitleaks/gitleaks/releases/download/v{VERSION}/"
        f"gitleaks_{VERSION}_{target}.tar.gz"
    )
    with urllib.request.urlopen(url, timeout=30) as response:
        archive = response.read()
    if hashlib.sha256(archive).hexdigest() != checksum:
        raise RuntimeError("Gitleaks archive checksum mismatch")
    binary = folder / "gitleaks"
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as package:
        # Read only the binary; never extract archive-supplied paths.
        with package.extractfile("gitleaks") as source:
            binary.write_bytes(source.read())
    binary.chmod(0o755)
    return binary


def scan(binary: Path, repository: Path, report: Path, ignore: Path) -> int:
    return subprocess.run(
        [
            str(binary), "git", "--redact", "--no-banner", "--log-opts=--all",
            "--report-format=json", f"--report-path={report}",
            f"--gitleaks-ignore-path={ignore}", str(repository),
        ],
        check=False,
    ).returncode


def self_test(binary: Path, folder: Path, ignore: Path) -> None:
    repository = folder / "fixture"
    repository.mkdir()
    env = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}
    for command in [
        ["init", "--quiet"],
        ["config", "user.name", "Local scanner fixture"],
        ["config", "user.email", "scanner@example.test"],
    ]:
        subprocess.run(["git", "-C", str(repository), *command], env=env, check=True)
    # A generated, nonfunctional value proves detection without using any real credential.
    token = secrets.token_hex(32)
    (repository / "fixture.env").write_text(f'api_key = "{token}"\n')
    subprocess.run(["git", "-C", str(repository), "add", "fixture.env"], env=env, check=True)
    subprocess.run(
        ["git", "-C", str(repository), "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"],
        env=env, check=True,
    )
    report = folder / "fixture.json"
    if scan(binary, repository, report, ignore) != 1:
        raise RuntimeError("Secret scanner did not reject the synthetic credential")
    findings = json.loads(report.read_text())
    if not findings or token in report.read_text():
        raise RuntimeError("Secret scanner report is empty or not redacted")
    print("Synthetic credential detection and report redaction passed", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    shallow = subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "--is-shallow-repository"], text=True
    ).strip()
    if shallow != "false":
        raise RuntimeError("Secret scanning requires complete Git history; use fetch-depth: 0")
    report = args.report.resolve()
    report.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="barghsa-secret-scan-") as directory:
        folder = Path(directory)
        binary = install(folder)
        ignore = root / ".gitleaksignore"
        self_test(binary, folder, ignore)
        return scan(binary, root, report, ignore)


if __name__ == "__main__":
    raise SystemExit(main())
