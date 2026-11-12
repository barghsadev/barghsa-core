"""Protected rollout identity, receipts and single-write marker reconciliation."""

from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time
from urllib.request import HTTPRedirectHandler

ROOT = Path(__file__).resolve().parents[2]
LIMIT = 65536


class ReleaseEvidenceError(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise ReleaseEvidenceError(reason)


@contextmanager
def protected_file(path, *, state=False):
    flags = os.O_RDWR | os.O_CREAT if state else os.O_RDONLY
    mode = 'r+b' if state else 'rb'
    with os.fdopen(os.open(path, flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600), mode) as file:
        info = os.fstat(file.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o077,
                'unsafe_annotation_file')
        yield file


def bounded_json(file):
    raw = file.readline(LIMIT + 1)
    require(len(raw) <= LIMIT, 'annotation_input_too_large')
    if not raw:
        return None
    value = json.loads(raw)
    require(raw.endswith(b'\n') and isinstance(value, dict), 'rollout_receipt_invalid')
    return value


def checked_checkout():
    def git(*args):
        return subprocess.check_output(['git', '-C', str(ROOT), *args],
                                       text=True, stderr=subprocess.DEVNULL, timeout=5)

    commit = git('rev-parse', 'HEAD').strip()
    require(re.fullmatch(r'[a-f0-9]{40}', commit), 'release_checkout_invalid')
    version = json.loads(git('show', commit + ':package.json'))['version']
    require(re.fullmatch(r'\d+\.\d+\.\d+', version), 'release_checkout_invalid')
    git('cat-file', '-e', f'{commit}:releases/{version}.md')
    return commit, version


def completed_rollout(receipt, commit, scope):
    with protected_file(receipt) as file:
        plan = bounded_json(file)
        require(isinstance(plan, dict) and plan.get('event') == 'plan' and plan.get('scope') == scope
                and isinstance(plan.get('candidate'), dict) and plan['candidate'].get('commit') == commit,
                'rollout_identity_mismatch')
        previous, last, cutover = None, plan, None
        while (row := bounded_json(file)) is not None:
            require(last.get('event') != 'completed'
                    and row.get('event') not in ('halted', 'rolled_back', 'rollback_unverified'),
                    'rollout_not_completed')
            if row.get('event') == 'traffic_verified' and row.get('weight') == 100:
                cutover = row.get('recorded_at')
            previous, last = last, row
    require(last.get('event') == 'completed' and last.get('weight') == 100 and previous is not None
            and previous.get('event') == 'observation' and previous.get('weight') == 100
            and previous.get('ready') is True and type(cutover) in (int, float)
            and type(previous.get('recorded_at')) in (int, float)
            and type(last.get('recorded_at')) in (int, float)
            and 0 < cutover <= previous['recorded_at'] <= last['recorded_at'] <= time.time(),
            'rollout_not_completed')
    return int(cutover * 1000), last['recorded_at']


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def publish_once(state_path, fingerprint, readback, send, error_prefix):
    fingerprint = fingerprint.encode() + b'\n'
    directory = state_path.parent.stat()
    require(directory.st_uid == os.geteuid() and not directory.st_mode & 0o022,
            'unsafe_annotation_directory')
    with protected_file(state_path, state=True) as state:
        fcntl.flock(state, fcntl.LOCK_EX | fcntl.LOCK_NB)
        pending = state.read(LIMIT + 1)
        require(not pending or pending == fingerprint, error_prefix + '_state_conflict')
        found = readback()
        if found is not None:
            return found
        require(not pending, error_prefix + '_delivery_unconfirmed')
        state.write(fingerprint)
        state.flush()
        os.fsync(state.fileno())
        directory_fd = os.open(state_path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        try:
            send()
        except (ReleaseEvidenceError, OSError, ValueError):
            pass
        found = readback()
        require(found is not None, error_prefix + '_delivery_unconfirmed')
        return found
