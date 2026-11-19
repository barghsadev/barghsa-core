#!/usr/bin/env python3
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess

service = 'barghsa-staging-postgres-offsite.service'
metrics = '/var/lib/barghsa-staging-postgres-backup-metrics'
source = '/opt/barghsa/staging/postgres-backup-monitor/run_backup_job.py'
base = Path('/var/lib/barghsa-staging-backups')
manifest = Path('/etc/barghsa/staging/active-images.env')
invocation = os.environ['INVOCATION_ID']
if not re.fullmatch(r'[a-f0-9]{32}', invocation):
    raise SystemExit('Invalid backup service invocation identity')

passed = (os.environ.get('SERVICE_RESULT') == 'success' and
          os.environ.get('EXIT_CODE') == 'exited' and os.environ.get('EXIT_STATUS') == '0')
verified = 0
now = int(datetime.now(timezone.utc).timestamp())

def read_completed_at():
    subprocess.run(['journalctl', '--sync'], check=True, capture_output=True, timeout=10)
    messages = subprocess.check_output(
        ['journalctl', '--no-pager', '--output=cat', '-u', service,
         '_SYSTEMD_INVOCATION_ID=' + invocation], text=True, timeout=10)
    selected = []
    for line in messages.splitlines():
        if line.startswith('{'):
            value = json.loads(line)
            if set(value) == {'label', 'bytes', 'sha256'}:
                selected.append(value)
    entry, = selected
    if not re.fullmatch(r'eu-scheduled-[0-9]{8}T[0-9]{6}Z-[0-9]+', entry['label']):
        raise ValueError('Unrecognized backup label')
    if not re.fullmatch(r'[a-f0-9]{64}', entry['sha256']):
        raise ValueError('Invalid backup checksum')
    path = base / (entry['label'] + '.json')
    record = json.loads(path.read_text())
    if not (record['label'] == entry['label'] and record['size'] == entry['bytes'] > 0
            and record['sha256'] == entry['sha256'] and record['upload_verified'] is True
            and record['manifest_readback_verified'] is True):
        raise ValueError('Backup journal entry and verified receipt differ')
    completed = datetime.fromisoformat(record['completed_at'].replace('Z', '+00:00'))
    if completed.tzinfo is None:
        raise ValueError('Backup completion requires timezone')
    timestamp = int(completed.timestamp())
    if not 0 < timestamp <= now:
        raise ValueError('Invalid backup completion')
    return timestamp

invalid_receipt = False
if passed:
    try:
        verified = read_completed_at()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError):
        passed = False
        invalid_receipt = True

images = [line.split('=', 1)[1] for line in manifest.read_text().splitlines()
          if line.startswith('BARGHSA_POSTGRES_IMAGE_ID=')]
image, = images
if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
    raise SystemExit('Invalid backup reporter image identity')
write_metrics = ('import sys; from pathlib import Path; from run_backup_job import report_metrics; '
                 'report_metrics(Path("/metrics/postgres-backup.prom"), int(sys.argv[1]), '
                 'sys.argv[2] == "1", int(sys.argv[3]))')
subprocess.run(['/usr/bin/docker', 'run', '--rm', '--pull=never', '--read-only', '--network', 'none',
                '--no-healthcheck', '--user', '0', '--cap-drop', 'ALL', '--memory', '128m',
                '--security-opt', 'no-new-privileges=true', '-e', 'PYTHONDONTWRITEBYTECODE=1',
                '-e', 'PYTHONPATH=/reviewed:/opt/backup',
                '--mount', f'type=bind,src={metrics},dst=/metrics',
                '--mount', f'type=bind,src={source},dst=/reviewed/run_backup_job.py,readonly',
                '--entrypoint', 'python3', image, '-c', write_metrics, str(now), str(int(passed)), str(verified)],
               check=True, timeout=30)
print(json.dumps({'backup_metrics':'reported','invocation':invocation,'job_timestamp':now,
                  'job_success':int(passed),'verified_timestamp':verified}))
if invalid_receipt:
    raise SystemExit('Successful backup has no matched verified receipt')
