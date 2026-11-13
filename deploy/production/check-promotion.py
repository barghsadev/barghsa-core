#!/usr/bin/env python3
"""Collect read-only verification for a production approval package."""

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import runpy
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[2]
REPO = 'barghsadev/barghsa-core'
STAGING = 'https://stg.barghsa.com'
RELEASE_CHAT_ID = -1004467450624
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
CORE_RECOVERY_CHECKS = frozenset({
    'configuration_restore', 'object_restore', 'readiness', 'login', 'dashboard', 'wallet',
    'electricity', 'saving', 'solar', 'consultation',
})


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


def receipt_path(directory, name, kind):
    if not isinstance(name, str) or not name or Path(name).is_absolute():
        raise ValueError(f'Use a relative receipt path for {kind}')
    path = (directory / name).resolve()
    if not path.is_relative_to(directory) or not path.is_file() or path.stat().st_size == 0:
        raise ValueError(f'Missing or invalid receipt for {kind}')
    return path


def file_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as receipt:
        for block in iter(lambda: receipt.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def index_receipts(index_path, sha):
    index = json.loads(index_path.read_text())
    receipts = index['receipts']
    if (index['candidate_sha'] != sha or not isinstance(receipts, dict)
            or set(receipts) != set(OPERATIONAL_RECEIPTS)):
        raise ValueError('Receipt index must identify the candidate and every operational receipt')
    directory = index_path.resolve().parent
    paths, hashes = {}, {}
    for kind, name in receipts.items():
        path = paths[kind] = receipt_path(directory, name, kind)
        hashes[kind] = file_digest(path)
    return paths, hashes


def receipt_bundle(index_path, path, fingerprint, required, optional=()):
    def read(file):
        with file.open('rb') as source:
            content = source.read(65537)
        if len(content) > 65536:
            raise ValueError('Structured receipt exceeds its size limit')
        value = json.loads(content)
        if not isinstance(value, dict):
            raise ValueError('Structured receipt must be a JSON object')
        return value, hashlib.sha256(content).hexdigest()

    bundle, digest = read(path)
    if digest != fingerprint or not set(required).issubset(bundle) or set(bundle) - set(required) - set(optional):
        raise ValueError('Invalid or changed structured receipt index')
    directory = index_path.resolve().parent
    entries = {key: read(receipt_path(directory, name, key)) for key, name in bundle.items()}
    return ({key: value for key, (value, _) in entries.items()},
            {key: digest for key, (_, digest) in entries.items()})


def epoch(value):
    try:
        parsed = datetime.fromisoformat(value.removesuffix('Z') + '+00:00' if value.endswith('Z') else value)
        if parsed.utcoffset() is not None:
            return parsed.timestamp()
    except (AttributeError, TypeError, ValueError, OverflowError, OSError):
        pass
    raise ValueError('A structured receipt has an invalid timestamp')


def matches(pattern, value):
    return isinstance(value, str) and bool(re.fullmatch(pattern, value))


def verify_core_recovery(core, database, database_digest, directory, sha, now):
    if (core.get('status') != 'passed' or core.get('scope') != 'core_service_recovery'
            or core.get('candidate_sha') != sha
            or core.get('database_restore_sha256') != database_digest):
        raise ValueError('Core-service recovery must identify this candidate and database exercise')
    started = epoch(core.get('started_at'))
    completed = epoch(core.get('completed_at'))
    database_start = epoch(database.get('started_at'))
    database_ready = database_start + database['database_rto_seconds']
    if (not started <= database_start <= database_ready <= completed <= now
            or not 0 < completed - started <= 3600):
        raise ValueError('Core-service recovery exceeds its 60-minute limit or has inconsistent timing')
    checks = core.get('checks')
    if not isinstance(checks, dict) or set(checks) != CORE_RECOVERY_CHECKS:
        raise ValueError('Core-service recovery must record every required check')
    times, evidence = {}, {}
    for name, check in checks.items():
        if not isinstance(check, dict) or check.get('status') != 'passed':
            raise ValueError('A required core-service recovery check did not pass')
        verified = times[name] = epoch(check.get('verified_at'))
        if not started <= verified <= completed:
            raise ValueError('A core-service recovery check is outside the verified exercise window')
        path = receipt_path(directory, check.get('evidence'), name)
        if path not in evidence:
            evidence[path] = file_digest(path)
        if evidence[path] != check.get('evidence_sha256'):
            raise ValueError('A core-service recovery evidence file changed')
    if (times['readiness'] < max(database_ready, times['configuration_restore'], times['object_restore'])
            or times['login'] < times['readiness']
            or any(times[name] < times['login'] for name in CORE_RECOVERY_CHECKS - {
                'configuration_restore', 'object_restore', 'readiness', 'login',
            })):
        raise ValueError('Core-service recovery must verify the restored application before service journeys')
    return round(completed - started, 3)


def verify_backup_receipts(index_path, path, fingerprint, now, sha):
    data, digests = receipt_bundle(index_path, path, fingerprint,
                                  ('backup_job', 'backup_manifest', 'restore_manifest', 'restore_report',
                                   'core_service_report'))
    job, manifest = data['backup_job'], data['backup_manifest']
    restored, report = data['restore_manifest'], data['restore_report']
    for value in (manifest, restored):
        if (type(value.get('version')) is not int or value['version'] != 1
                or not matches(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', value.get('label'))
                or not matches(r'[0-9]+', value.get('system_id'))
                or not matches(r'blobs/[a-f0-9]{32}\.tar\.gpg', value.get('blob'))
                or not matches(r'[a-f0-9]{64}', value.get('sha256'))
                or type(value.get('size')) is not int or value['size'] <= 0):
            raise ValueError('Encrypted backup manifest is invalid')
    completed = epoch(manifest.get('completed_at'))
    if (job.get('status') != 'passed' or job.get('phase') != 'retention' or job.get('monitoring') == 'failed'
            or not matches(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z', job.get('backup'))
            or job['backup'] != manifest.get('label')
            or not epoch(job.get('started_at')) <= epoch(manifest.get('started_at')) <= completed <= now
            or now - completed >= 86400):
        raise ValueError('The latest successful verified backup must be less than 24 hours old')
    if (report.get('status') != 'passed' or report.get('scope') != 'database_restore'
            or report.get('backup') != restored['label']
            or restored['system_id'] != manifest['system_id']
            or not epoch(restored.get('started_at')) <= epoch(restored.get('completed_at'))
            <= epoch(report.get('started_at')) <= now
            or epoch(report.get('replayed_transaction_time')) > now):
        raise ValueError('Restore report does not verify a backup from the same database system')
    for field, maximum in (('rpo_seconds', 300), ('database_rto_seconds', 3600)):
        value = report.get(field)
        if type(value) not in (int, float) or not 0 <= value <= maximum:
            raise ValueError('Restore report exceeds the database recovery limits')
    tables = report.get('tables')
    if not isinstance(tables, dict) or set(tables) != {'users', 'orders', 'invoices'} or any(
        not isinstance(table, dict) or type(table.get('count')) is not int or table['count'] < 0
        or not matches(r'[a-f0-9]{64}', table.get('sha256')) for table in tables.values()
    ):
        raise ValueError('Restore report is missing verified table fingerprints')
    core_rto = verify_core_recovery(data['core_service_report'], report, digests['restore_report'],
                                    index_path.resolve().parent, sha, now)
    return {'backup_age_seconds': round(now - completed, 3), 'rpo_seconds': report['rpo_seconds'],
            'database_rto_seconds': report['database_rto_seconds'], 'core_service_rto_seconds': core_rto,
            'sha256': digests}


def verify_release_receipts(index_path, path, fingerprint, version, sha):
    data, digests = receipt_bundle(index_path, path, fingerprint, ('deployment', 'summary'), ('album',))
    job, summary = data['deployment'], data['summary']
    identity = {'version': version, 'commit': sha}
    if (job.get('phase') != 'completed' or any(job.get(key) != value for key, value in identity.items())
            or job.get('live_release') != identity or not 0 < epoch(job.get('completed_at')) <= time.time()):
        raise ValueError('Deployment receipt does not confirm this staging release')
    metadata, text = runpy.run_path(str(ROOT / 'deploy/staging/notify-release.py'))['release_details'](ROOT, sha)
    if metadata != identity:
        raise ValueError('The release notes checkout does not match the staged receipt')

    def confirmed(receipt):
        return (receipt.get('status') == 'sent' and receipt.get('chat_id') == RELEASE_CHAT_ID
                and all(receipt.get(key) == value for key, value in identity.items()))

    message_id = summary.get('message_id')
    if (not confirmed(summary) or type(message_id) is not int or message_id <= 0
            or summary.get('text_sha256') != hashlib.sha256(text.encode()).hexdigest()):
        raise ValueError('Telegram summary receipt does not confirm this release and its exact notes')
    images = job.get('screenshots')
    if (not isinstance(images, list) or len(images) > 10
            or not all(matches(r'[a-f0-9]{64}\.png', name) for name in images) or len(set(images)) != len(images)):
        raise ValueError('Deployment receipt has an invalid screenshot selection')
    album = data.get('album')
    message_ids = []
    if album is not None:
        message_ids = album.get('message_ids')
        group = album.get('media_group_id')
        if (not images or not confirmed(album) or album.get('photo_sha256') != [name[:-4] for name in images]
                or not isinstance(message_ids, list) or len(message_ids) != len(images)
                or any(type(value) is not int or value <= 0 for value in message_ids)
                or len(set(message_ids)) != len(images) or message_id in message_ids
                or (len(images) > 1 and (not isinstance(group, str) or not group))):
            raise ValueError('Telegram image receipt does not confirm one release album')
    elif images:
        warning = job.get('screenshot_warning')
        if (not isinstance(warning, dict) or type(warning.get('exit_code')) is not int
                or warning['exit_code'] == 0 or not isinstance(warning.get('message'), str)
                or not warning['message']):
            raise ValueError('A screenshot receipt is required for the queued images')
    return {'summary_message_id': message_id, 'image_message_ids': message_ids,
            'album_unconfirmed': bool(images and not album), 'sha256': digests}


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
        paths, hashes = index_receipts(args.receipt_index, sha)
        ci_url = verify_workflow(args.ci_run, '.github/workflows/ci.yml', sha)
        verify_ci_checks(args.ci_run)
        browser_url = verify_workflow(args.browser_run, '.github/workflows/browser-nightly.yml', sha)
        with tempfile.TemporaryDirectory(prefix='barghsa-promotion-') as temporary:
            directory = Path(temporary)
            command('Strict quarantine', sys.executable, 'scripts/check-flaky-tests.py',
                    '--promotion', '--report', str(directory / 'quarantine.json'))
            counts = verify_browser_rollup(args.browser_run, directory)
        verify_staging(version, sha)
        checked_at = time.time()
        backup = verify_backup_receipts(args.receipt_index, paths['backup_and_restore'],
                                        hashes['backup_and_restore'], checked_at, sha)
        release = verify_release_receipts(args.receipt_index, paths['staging_and_telegram'],
                                          hashes['staging_and_telegram'], version, sha)
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
                      'checked_at': checked_at,
                      'ci': ci_url, 'browser': browser_url, 'browser_counts': counts,
                      'operational_receipt_sha256': hashes, 'verified_backup': backup,
                      'verified_staging_and_telegram': release}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
