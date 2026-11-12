#!/usr/bin/env python3
"""Reuse only a matching affected-test receipt from a completed preflight push."""

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


CHECK = 'Verify monorepo integrity'
WORKFLOW = '.github/workflows/ci.yml'
PREFIX = 'refs/heads/codex/preflight/'
RECEIPT = 'affected-test-receipt.json'
FRESHNESS = timedelta(hours=1)


def commit(value):
    return re.fullmatch(r'[0-9a-f]{40}', value) and value != '0' * 40


def proof(sha, base, run_id, attempt):
    return {'kind': 'affected-tests-v1', 'sha': sha, 'base': base,
            'run_id': run_id, 'attempt': attempt}


def gh(*args):
    return subprocess.run(['gh', *args], check=True, capture_output=True, text=True, timeout=15).stdout


def api(path, **query):
    return json.loads(gh('api', '--method', 'GET', path,
                         *(arg for key, value in query.items() for arg in ('-f', f'{key}={value}'))))


def exact_preflight(row, repo, sha):
    return (
        row['head_sha'] == sha and row['head_repository']['full_name'] == repo
        and row['path'] == WORKFLOW and row['event'] == 'push'
        and row['head_branch'].startswith(PREFIX.removeprefix('refs/heads/'))
        and row['status'] == 'completed' and row['conclusion'] == 'success'
        and type(row['id']) is int and row['id'] > 0
        and type(row['run_attempt']) is int and row['run_attempt'] > 0
        and type(row['check_suite_id']) is int and row['check_suite_id'] > 0
    )


def fresh_required_check(checks, sha, suite, now):
    if len(checks) != 1:
        return False
    check, = checks
    if (check['head_sha'] != sha or check['name'] != CHECK or check['app']['id'] != 15368
            or check['check_suite']['id'] != suite or check['status'] != 'completed'
            or check['conclusion'] != 'success'):
        return False
    completed = datetime.fromisoformat(check['completed_at'].replace('Z', '+00:00'))
    return timedelta(0) <= now - completed <= FRESHNESS


def read_receipt(repo, run_id, attempt):
    with tempfile.TemporaryDirectory(prefix='barghsa-preflight-receipt-') as directory:
        gh('run', 'download', str(run_id), '--repo', repo, '--name',
           f'affected-test-evidence-{attempt}', '--dir', directory)
        file = Path(directory) / RECEIPT
        if file.is_symlink():
            return None
        with file.open('rb') as stream:
            data = stream.read(4097)
        return json.loads(data) if len(data) <= 4096 else None


def find_preflight(repo, sha, base, now):
    runs = api(f'repos/{repo}/actions/workflows/ci.yml/runs', head_sha=sha, event='push',
               status='success', per_page=12)['workflow_runs']
    for run in runs:
        try:
            if not exact_preflight(run, repo, sha):
                continue
            suite = run['check_suite_id']
            checks = api(f'repos/{repo}/check-suites/{suite}/check-runs', check_name=CHECK)['check_runs']
            if not fresh_required_check(checks, sha, suite, now):
                continue
            run_id, attempt = run['id'], run['run_attempt']
            if read_receipt(repo, run_id, attempt) == proof(sha, base, run_id, attempt):
                return run_id
        except (AttributeError, KeyError, TypeError, ValueError, OSError, subprocess.SubprocessError):
            continue
    return None


def main(mode):
    sha = os.environ['GITHUB_SHA']
    base = os.environ.get('PUSH_TEST_BASE', '')
    ref = os.environ['GITHUB_REF']
    if (os.environ['GITHUB_EVENT_NAME'] != 'push' or os.environ['FULL_CI'] != 'false'
            or not commit(sha) or not commit(base) or sha == base):
        return
    output = Path(os.environ['GITHUB_OUTPUT'])
    if mode == 'write' and ref.startswith(PREFIX):
        run_id, attempt = int(os.environ['GITHUB_RUN_ID']), int(os.environ['GITHUB_RUN_ATTEMPT'])
        receipt = Path(os.environ['RUNNER_TEMP']) / RECEIPT
        receipt.write_text(json.dumps(proof(sha, base, run_id, attempt)) + '\n')
        with output.open('a') as stream:
            stream.write('saved=true\n')
    elif mode == 'reuse' and ref == 'refs/heads/main':
        repo = os.environ['GITHUB_REPOSITORY']
        run_id = find_preflight(repo, sha, base, datetime.now(timezone.utc))
        if run_id is not None:
            summary = Path(os.environ['GITHUB_STEP_SUMMARY'])
            with summary.open('a') as stream:
                stream.write(f'Reused affected tests for `{sha}` against `{base}` from '
                             f'[verified preflight {run_id}](https://github.com/{repo}/actions/runs/{run_id}).\n')
            with output.open('a') as stream:
                stream.write('reused=true\n')


if __name__ == '__main__':
    try:
        main(sys.argv[1])
    except (AttributeError, KeyError, TypeError, ValueError, OSError, subprocess.SubprocessError):
        print('Preflight test evidence unavailable. The normal test path remains enabled.')
