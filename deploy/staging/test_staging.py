#!/usr/bin/env python3
"""Validate resolved staging Compose without starting or pulling containers."""
import json
import os
from pathlib import Path
import subprocess
import tempfile


root = Path(__file__).resolve().parents[2]
compose = root / 'deploy/staging/compose.yml'
with tempfile.TemporaryDirectory(prefix='barghsa-staging-config-') as temporary:
    runtime = Path(temporary) / 'runtime.env'
    images = Path(temporary) / 'images.env'
    runtime.write_text('\n'.join([
        'POSTGRES_DB=barghsa_staging', 'POSTGRES_USER=barghsa', 'POSTGRES_PASSWORD=test-only',
        'DATABASE_URL=postgresql://barghsa:test-only@postgres:5432/barghsa_staging',
        'S3_ACCESS_KEY_ID=test-only', 'S3_SECRET_ACCESS_KEY=test-only',
        'S3_BUCKET=barghsa-staging',
    ]))
    digest = 'a' * 64
    images.write_text('\n'.join(
        f'BARGHSA_{name}_IMAGE=ghcr.io/example/{name.lower()}@sha256:{digest}'
        for name in ('APP', 'WEB', 'POSTGRES', 'CLAMAV', 'REDIS', 'OBJECTSTORE')
    ))
    result = subprocess.run(
        ['docker', 'compose', '--env-file', str(runtime), '--env-file', str(images),
         '-f', str(compose), 'config', '--format', 'json'],
        cwd=root, env={**os.environ, 'BARGHSA_RUNTIME_ENV_FILE': str(runtime)},
        capture_output=True, text=True, check=True,
    )
    services = json.loads(result.stdout)['services']
    expected = {'postgres', 'redis', 'objectstore', 'clamav', 'api', 'worker', 'web'}
    assert expected <= services.keys()
    assert services['api']['image'] == services['worker']['image']
    assert services['worker']['command'] == ['node', 'worker/dist/main.js']
    for service in ('postgres', 'redis', 'clamav', 'worker'):
        assert not services[service].get('ports'), service
    for service in ('api', 'web', 'objectstore'):
        assert all(port['host_ip'] == '127.0.0.1' for port in services[service]['ports'])
    for service in ('api', 'web', 'worker'):
        assert services[service]['read_only'] is True
        assert services[service]['cap_drop'] == ['ALL']
    assert services['postgres']['environment']['POSTGRES_PASSWORD'] == 'test-only'
    assert services['objectstore']['environment']['AWS_SECRET_ACCESS_KEY'] == 'test-only'
    assert services['objectstore']['environment']['S3_BUCKET'] == 'barghsa-staging'

for script in ('release.sh', 'backup.sh'):
    subprocess.run(['bash', '-n', str(root / 'deploy/staging' / script)], check=True)
print('PASS staging Compose isolation, image wiring, and script syntax')
