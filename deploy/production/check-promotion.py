#!/usr/bin/env python3
"""Collect read-only verification for a production approval package."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[2]
REPO = 'barghsadev/barghsa-core'
STAGING = 'https://stg.barghsa.com'
OPERATIONAL_RECEIPTS = (
    'authenticated_dast',
    'performance_and_load',
    'migration_and_rollback',
    'backup_and_restore',
    'rollout_controls',
    'image_digests_and_scans',
    'provider_and_storage',
    'security_and_incident_review',
    'release_notes_and_on_call',
    'staging_and_telegram',
)


def command(label, *args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise ValueError(f'{label} failed')
    return result.stdout.strip()


def verify_workflow(run_id, path, sha):
    run = json.loads(command('Hosted workflow readback', 'gh', 'api',
                             f'repos/{REPO}/actions/runs/{run_id}'))
    if (run['path'] != path or run['repository']['full_name'] != REPO
            or run['head_repository']['full_name'] != REPO or run['head_sha'] != sha
            or run['event'] != 'workflow_dispatch' or run['status'] != 'completed'
            or run['conclusion'] != 'success'):
        raise ValueError(f'Run {run_id} must be a successful manual {path} run for the candidate')
    return run['html_url']


def verify_ci_checks(run_id):
    required = {
        'Run tests': 'Run affected tests or full coverage',
        'Scan runtime container images': 'Check shipped component licenses',
        'Verify combined source coverage': 'Enforce changed source and critical file coverage',
    }
    response = json.loads(command(
        'Hosted CI checks readback', 'gh', 'api',
        f'repos/{REPO}/actions/runs/{run_id}/jobs?per_page=100&filter=latest',
    ))
    successful = {
        job['name']: {step['name'] for step in job['steps'] if step['conclusion'] == 'success'}
        for job in response['jobs'] if job['conclusion'] == 'success'
    }
    if any(step not in successful.get(job, set()) for job, step in required.items()):
        raise ValueError('Full tests, enforced licenses and combined coverage must each pass')


def verify_browser_rollup(run_id, directory):
    command('Hosted browser outcome download', 'gh', 'run', 'download', str(run_id),
            '--repo', REPO, '--name', 'nightly-browser-summary', '--dir', str(directory))
    rollup = json.loads((directory / 'nightly-browser-summary.json').read_text())
    counts = rollup['counts']
    if (rollup['schema_version'] != 1 or rollup['status'] != 'passed' or rollup['reported_shards'] != 40
            or rollup['expected_shards'] != 40 or counts['expected'] <= 0
            or rollup['missing_or_invalid_shards'] or rollup['failed_shards']
            or any(counts[key] != 0 for key in ('unexpected', 'flaky', 'runner_errors'))):
        raise ValueError('The browser rollup must pass for all 40 shards')
    return counts


def staging_response(path):
    url = f'{STAGING}{path}'
    with urlopen(url, timeout=15) as response:
        if response.geturl() != url:
            raise ValueError('Staging readback must use the designated HTTPS endpoint')
        body = response.read(65537)
    if len(body) > 65536:
        raise ValueError('Staging readback exceeded its response limit')
    return json.loads(body)


def verify_staging(version, sha):
    live = staging_response('/release.json')
    if live['version'] != version or live['commit'] != sha:
        raise ValueError('Staging is serving a different candidate')
    readiness = staging_response('/api/health/ready')
    if readiness['status'] != 'ok':
        raise ValueError('Staging readiness must be healthy')


def index_receipts(index_path, sha):
    index = json.loads(index_path.read_text())
    receipts = index['receipts']
    if (index['candidate_sha'] != sha or not isinstance(receipts, dict)
            or set(receipts) != set(OPERATIONAL_RECEIPTS)):
        raise ValueError('Receipt index must identify the candidate and every operational receipt')
    directory = index_path.resolve().parent
    hashes = {}
    for kind, name in receipts.items():
        if not isinstance(name, str) or not name or Path(name).is_absolute():
            raise ValueError(f'Use a relative receipt path for {kind}')
        path = (directory / name).resolve()
        if not path.is_relative_to(directory) or not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f'Missing or invalid receipt for {kind}')
        digest = hashlib.sha256()
        with path.open('rb') as receipt:
            for block in iter(lambda: receipt.read(1024 * 1024), b''):
                digest.update(block)
        hashes[kind] = digest.hexdigest()
    return hashes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ci-run', required=True, type=int)
    parser.add_argument('--browser-run', required=True, type=int)
    parser.add_argument('--receipt-index', required=True, type=Path)
    args = parser.parse_args()
    try:
        if command('Candidate worktree check', 'git', 'status', '--porcelain'):
            raise ValueError('Run from a clean candidate checkout')
        sha = command('Candidate commit readback', 'git', 'rev-parse', 'HEAD')
        version = json.loads((ROOT / 'package.json').read_text())['version']
        if not re.fullmatch(r'[a-f0-9]{40}', sha) or version != '0.9.0':
            raise ValueError('Use the immutable v0.9.0 first-launch candidate')
        command('Launch board', sys.executable, 'kanban/scripts/board.py', 'ready', '--release', version)
        hashes = index_receipts(args.receipt_index, sha)
        ci_url = verify_workflow(args.ci_run, '.github/workflows/ci.yml', sha)
        verify_ci_checks(args.ci_run)
        browser_url = verify_workflow(args.browser_run, '.github/workflows/browser-nightly.yml', sha)
        with tempfile.TemporaryDirectory(prefix='barghsa-promotion-') as temporary:
            directory = Path(temporary)
            command('Strict quarantine', sys.executable, 'scripts/check-flaky-tests.py',
                    '--promotion', '--report', str(directory / 'quarantine.json'))
            counts = verify_browser_rollup(args.browser_run, directory)
        verify_staging(version, sha)
    except ValueError as error:
        # JSON parse errors can include arbitrary input. Report a fixed failure for them.
        message = ('Invalid verification response or receipt JSON'
                   if isinstance(error, (json.JSONDecodeError, UnicodeError)) else str(error))
        print(f'Promotion check blocked. {message}', file=sys.stderr)
        return 1
    except (KeyError, OSError, TypeError, subprocess.TimeoutExpired):
        print('Promotion check blocked. A required input or verification service was unavailable.',
              file=sys.stderr)
        return 1
    print(json.dumps({'status': 'ready_for_owner_review', 'version': version, 'candidate_sha': sha,
                      'ci': ci_url, 'browser': browser_url, 'browser_counts': counts,
                      'operational_receipt_sha256': hashes}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
