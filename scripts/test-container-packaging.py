#!/usr/bin/env python3
"""Smoke production images on isolated Docker resources, without published ports.

Build barghsa-audit-api:v01-images and barghsa-audit-web:v01-images first.
API and worker use the exact same image ID with a command override.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid


prefix = 'barghsa-packaging-' + uuid.uuid4().hex[:10]
owned = []


def docker(*args, check=True):
    result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=90)
    if check and result.returncode:
        raise AssertionError(f'{args[0]}: {result.stderr[-1800:]} {result.stdout[-1800:]}')
    return result


def eventually(predicate):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.3)
    raise AssertionError('Container did not reach expected state')


def health(name):
    command = 'healthcheck.js' if name.endswith('-web') else 'healthcheck-runtime.cjs'
    return docker('exec', name, 'node', command, check=False).returncode == 0


def probe(name, port, path):
    return int(docker('exec', name, 'node', '-e',
                     f'fetch("http://127.0.0.1:{port}{path}").then(r=>console.log(r.status))').stdout)


def check_compose():
    with tempfile.TemporaryDirectory(prefix='barghsa-compose-proof-') as temporary:
        runtime = Path(temporary) / 'runtime.env'
        values = dict(BARGHSA_RUNTIME_ENV_FILE=str(runtime),
                      DATABASE_URL='postgresql://test:synthetic@postgres:5432/barghsa',
                      APP_PUBLIC_URL='https://app.example.test', API_PUBLIC_URL='https://app.example.test',
                      PAYMENT_GATEWAY_MERCHANT_ID='synthetic-only', AUTH_DELIVERY_ENCRYPTION_KEY='11'*32)
        runtime.write_text('\n'.join(f'{k}={v}' for k, v in values.items()))
        result = subprocess.run(['docker', 'compose', '--env-file', str(runtime),
                                 '-f', 'docker-compose.yml', '-f', 'docker-compose.prod.yml',
                                 'config', '--format', 'json'], capture_output=True, text=True,
                                env={**os.environ, **values}, cwd=Path(__file__).resolve().parents[1])
        assert result.returncode == 0, result.stderr
        services = json.loads(result.stdout)['services']
        assert 'pgbouncer' in services
        assert services['api']['build'] == services['worker']['build']
        assert services['worker']['command'] == ['node', 'worker/dist/main.js']
        for name in ['api', 'worker', 'web']:
            service = services[name]
            assert service['read_only'] and service['cap_drop'] == ['ALL']
            assert 'no-new-privileges:true' in service['security_opt']
        assert services['api']['healthcheck']['test'] == ['CMD', 'node', 'healthcheck-runtime.cjs']
    print('PASS production Compose: shared image, worker override, hardening and enabled pool dependency', flush=True)


check_compose()
if '--compose-only' in sys.argv:
    raise SystemExit(0)

try:
    docker('network', 'create', '--internal', prefix)
    db = prefix + '-db'
    owned.append(db)
    docker('run', '-d', '--name', db, '--network', prefix, '--network-alias', 'database',
           '-e', 'POSTGRES_PASSWORD=synthetic-only', '-e', 'POSTGRES_DB=audit',
           'barghsa-backup-audit:local')
    eventually(lambda: docker('exec', db, 'pg_isready', '-U', 'postgres', check=False).returncode == 0)
    database = 'postgresql://postgres:synthetic-only@database:5432/audit'
    image = 'barghsa-audit-api:v01-images'
    migrate = ('const p=require("node:path");const {spawnSync}=require("node:child_process");'
               'process.exit(spawnSync(process.execPath,[p.join(p.dirname(require.resolve("@barghsa/db")),'
               '"migrate.js")],{stdio:"inherit"}).status??1)')
    docker('run', '--rm', '--network', prefix, '--read-only', '-e', 'DATABASE_URL='+database,
           image, 'node', '-e', migrate)
    print('PASS packaged canonical migrations', flush=True)
    ids = []
    for kind in ['api', 'worker', 'web']:
        name = prefix + '-' + kind
        owned.append(name)
        command = ['node', 'worker/dist/main.js'] if kind == 'worker' else []
        selected = 'barghsa-audit-web:v01-images' if kind == 'web' else image
        docker('run', '-d', '--name', name, '--network', prefix, '--read-only',
               '--cap-drop=ALL', '--security-opt=no-new-privileges', '--tmpfs=/tmp:size=64m,mode=1777',
               '-e', 'DATABASE_URL='+database, '-e', 'APP_PUBLIC_URL=https://app.example.test',
               '-e', 'API_PUBLIC_URL=https://app.example.test',
               '-e', 'PAYMENT_GATEWAY_MERCHANT_ID=synthetic-no-payments',
               '-e', 'AUTH_DELIVERY_ENCRYPTION_KEY='+'11'*32,
               selected, *command)
        info = json.loads(docker('inspect', name).stdout)[0]
        assert info['Config']['User'] == 'node'
        assert info['HostConfig']['ReadonlyRootfs']
        assert info['HostConfig']['CapDrop'] == ['ALL']
        assert info['Config']['Env'].count('NODE_ENV=production') == 1
        if kind != 'web':
            ids.append(info['Image'])
        eventually(lambda: health(name))
        assert docker('exec', name, 'node', '-e',
                      'require("node:fs").writeFileSync("/app/must-not-write","x")', check=False).returncode != 0
    assert ids[0] == ids[1]
    print('PASS identical image starts API and worker by command override; non-root/read-only readiness', flush=True)
    api, worker, web = [prefix+'-'+k for k in ['api', 'worker', 'web']]
    assert probe(web, 3000, '/') == 200
    assert probe(web, 3000, '/dashboard') == 200
    docker('stop', db)
    assert not health(api) and not health(worker)
    assert probe(api, 4000, '/api/health/live') == 200
    assert probe(worker, 9090, '/health/live') == 200
    docker('start', db)
    eventually(lambda: health(api) and health(worker))
    print('PASS dependency loss fails both readiness probes; recovery restores readiness', flush=True)
    for name in [worker, api, web]:
        docker('kill', '--signal=TERM', name)
        assert docker('wait', name).stdout.strip() == '0'
    print('PASS API/worker/web clean SIGTERM exit', flush=True)
except Exception:
    for name in owned:
        if not name.endswith('-db'):
            print(name, docker('logs', '--tail', '12', name, check=False).stdout[-2400:])
    raise
finally:
    for name in reversed(owned):
        docker('rm', '-f', name, check=False)
    docker('network', 'rm', prefix, check=False)
