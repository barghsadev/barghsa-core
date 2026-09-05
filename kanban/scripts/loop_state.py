"""Atomic local snapshots and append-only, remotely committed loop state.

The dedicated Git ref is authoritative. A failed push never authorizes a new
dispatch; a crash after a successful push recovers from the remote on restart.
No product working tree or index is used for state commits.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
            name = stream.name
            json.dump(value, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


class StateStore:
    def __init__(self, directory: Path, remote: str, ref: str = "refs/heads/kanban-state"):
        if not ref.startswith("refs/heads/kanban-state") or any(c in ref for c in " ~^:?*[\\"):
            raise ValueError("state ref must be a dedicated kanban-state branch")
        self.directory = directory
        self.repository = directory / "objects.git"
        self.remote = remote
        self.ref = ref
        self.revision: str | None = None
        self.snapshot: dict[str, Any] | None = None
        if not self.repository.exists():
            directory.mkdir(parents=True, exist_ok=True)
            subprocess.run(["git", "init", "--bare", str(self.repository)], check=True, capture_output=True)

    def git(self, *args: str, data: str | None = None) -> str:
        result = subprocess.run(
            ["git", "--git-dir", str(self.repository), *args], input=data,
            text=True, capture_output=True, timeout=60,
            env={**os.environ, "GIT_AUTHOR_NAME": "Barghsa supervisor",
                 "GIT_AUTHOR_EMAIL": "loop@barghsa.invalid",
                 "GIT_COMMITTER_NAME": "Barghsa supervisor",
                 "GIT_COMMITTER_EMAIL": "loop@barghsa.invalid"},
        )
        if result.returncode:
            raise RuntimeError(f"state Git operation {args[0]} failed: {result.stderr[-1000:]}")
        return result.stdout.strip()

    def remote_revision(self) -> str | None:
        output = self.git("ls-remote", "--refs", self.remote, self.ref)
        return output.split()[0] if output else None

    def read(self) -> dict[str, Any]:
        revision = self.remote_revision()
        if not revision:
            raise RuntimeError("remote loop state is not initialized; reconcile legacy records before bootstrap")
        self.git("fetch", "--no-tags", self.remote, self.ref)
        fetched = self.git("rev-parse", "FETCH_HEAD")
        if fetched != revision:
            raise RuntimeError("remote state changed during fetch; retry the tick")
        snapshot = json.loads(self.git("show", f"{revision}:state.json"))
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get("task_events"), list):
            raise RuntimeError("remote state has no task event ledger")
        self.revision = revision
        self.snapshot = snapshot
        atomic_json(self.directory / "state.json", snapshot)
        return json.loads(json.dumps(snapshot))

    def save(self, state: dict[str, Any], *, bootstrap: bool = False) -> None:
        current = self.remote_revision()
        if current != self.revision:
            raise RuntimeError("remote state advanced; stale supervisor cannot publish or dispatch")
        if self.snapshot is None and not bootstrap:
            raise RuntimeError("read remote state before saving")
        previous = self.snapshot or {}
        events = state.get("task_events")
        old_events = previous.get("task_events", [])
        if not isinstance(events, list) or events[:len(old_events)] != old_events:
            raise ValueError("task event history cannot be removed or rewritten")
        if not set(previous.get("build_completed_tasks", [])).issubset(state.get("build_completed_tasks", [])):
            raise ValueError("completion removal requires a reconciled correction, not a state overwrite")
        payload = json.dumps(state, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
        blob = self.git("hash-object", "-w", "--stdin", data=payload)
        tree = self.git("mktree", data=f"100644 blob {blob}\tstate.json\n")
        parents = ["-p", self.revision] if self.revision else []
        commit = self.git("commit-tree", tree, *parents, data="chore(kanban): persist supervisor transition\n")
        # CAS prevents racing supervisors, including an absent-ref bootstrap race.
        self.git("push", f"--force-with-lease={self.ref}:{self.revision or ''}", self.remote, f"{commit}:{self.ref}")
        if self.remote_revision() != commit:
            raise RuntimeError("state push could not be read back at the expected revision")
        self.revision = commit
        self.snapshot = json.loads(payload)
        atomic_json(self.directory / "state.json", state)
