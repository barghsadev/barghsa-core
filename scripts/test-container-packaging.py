#!/usr/bin/env python3
"""Smoke production images on isolated Docker resources, without published ports.

Build the app, web and backup PostgreSQL images before running this script.
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
node_options = '--max-old-space-size=512 --no-deprecation'
unsafe_node_options = '--inspect=0.0.0.0 --insecure-http-parser'


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


def check_node_security(name, port):
    docker('exec', name, 'node', '--input-type=module', '-e', r'''
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';

assert.ok(process.getuid() > 0 && process.getgid() > 0);
await assert.rejects(fetch('http://127.0.0.1:9229/json/list', {
  signal: AbortSignal.timeout(3000),
}), error => error.cause?.code === 'ECONNREFUSED');

// An insecure parser accepts the conflicting Content-Length and Transfer-Encoding.
const request = 'GET / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 4\r\n' +
  'Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n\r\n';
const socket = createConnection(Number(process.argv[1]), '127.0.0.1', () => socket.end(request));
socket.setTimeout(3000, () => socket.destroy(new Error('HTTP parser probe timed out')));
let response = '';
for await (const chunk of socket) response += chunk;
assert.match(response, /^HTTP\/1\.1 400\b/);
''', str(port))


def check_compose():
    with tempfile.TemporaryDirectory(prefix='barghsa-compose-proof-') as temporary:
        runtime = Path(temporary) / 'runtime.env'
        values = dict(BARGHSA_RUNTIME_ENV_FILE=str(runtime),
                      DATABASE_URL='postgresql://test:synthetic@postgres:5432/barghsa',
                      APP_PUBLIC_URL='https://app.example.test', API_PUBLIC_URL='https://app.example.test',
                      PAYMENT_GATEWAY_MERCHANT_ID='synthetic-only', AUTH_DELIVERY_ENCRYPTION_KEY='11'*32)
        runtime.write_text('\n'.join(f'{k}={v}' for k, v in values.items())
                           + f'\nNODE_OPTIONS={unsafe_node_options}\n')
        result = subprocess.run(['docker', 'compose', '--env-file', str(runtime),
                                 '-f', 'docker-compose.yml', '-f', 'docker-compose.prod.yml',
                                 'config', '--format', 'json'], capture_output=True, text=True,
                                env={**os.environ, **values}, cwd=Path(__file__).resolve().parents[1])
        assert result.returncode == 0, result.stderr
        services = json.loads(result.stdout)['services']
        assert 'pgbouncer' in services
        assert services['api']['build'] == services['worker']['build']
        assert services['worker']['command'] == ['node', 'worker/dist/main.js']
        for name in ['api', 'worker', 'web', 'ai-inference']:
            service = services[name]
            assert service['read_only'] and service['cap_drop'] == ['ALL']
            assert 'no-new-privileges:true' in service['security_opt']
            assert service['environment']['NODE_OPTIONS'] == node_options, name
        assert services['api']['healthcheck']['test'] == ['CMD', 'node', 'healthcheck-runtime.cjs']
    print('PASS production Compose: shared image, worker override, hardening and enabled pool dependency', flush=True)


def check_hybrid_compose():
    with tempfile.TemporaryDirectory(prefix='barghsa-hybrid-proof-') as temporary:
        fixture = Path(temporary)
        runtime = fixture / 'runtime.env'
        runtime.write_text(f'NODE_OPTIONS={unsafe_node_options}\n')
        ca = fixture / 'ca.pem'
        ca.write_text('synthetic only')
        env = {**os.environ, 'BARGHSA_RUNTIME_ENV_FILE': str(runtime),
               'BARGHSA_MIGRATION_ENV_FILE': str(runtime), 'BARGHSA_DATABASE_CA_FILE': str(ca)}
        for kind in ('APP', 'WEB', 'CLAMAV'):
            env[f'BARGHSA_{kind}_REPOSITORY'] = f'example.invalid/barghsa-{kind.lower()}'
            env[f'BARGHSA_{kind}_DIGEST'] = 'a' * 64
        config = subprocess.check_output(
            ['docker', 'compose', '-f', 'deploy/production/compose.yml', 'config', '--format', 'json'],
            env=env, cwd=Path(__file__).resolve().parents[1], text=True,
        )
        services = json.loads(config)['services']
        for name in ('api', 'worker', 'ai-inference', 'migrate'):
            service = services[name]
            assert service['environment']['NODE_OPTIONS'] == node_options, name
            assert service['read_only'] and service['cap_drop'] == ['ALL'], name
    print('PASS hybrid Compose ignores unsafe Node flags from runtime and migration files', flush=True)


check_compose()
check_hybrid_compose()
if '--compose-only' in sys.argv:
    raise SystemExit(0)

try:
    docker('network', 'create', '--internal', prefix)
    db = prefix + '-db'
    owned.append(db)
    postgres = os.environ.get('BARGHSA_TEST_POSTGRES_IMAGE', 'barghsa-backup-audit:local')
    image = os.environ.get('BARGHSA_TEST_APP_IMAGE', 'barghsa-audit-api:v01-images')
    web_image = os.environ.get('BARGHSA_TEST_WEB_IMAGE', 'barghsa-audit-web:v01-images')
    docker('run', '-d', '--pull=never', '--name', db, '--network', prefix, '--network-alias', 'database',
           '-e', 'POSTGRES_PASSWORD=synthetic-only', '-e', 'POSTGRES_DB=audit',
           postgres)
    # The image briefly starts a Unix-socket-only server while initializing the database.
    eventually(lambda: docker('exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres',
                              '-d', 'audit', check=False).returncode == 0)
    database = 'postgresql://postgres:synthetic-only@database:5432/audit'
    docker('run', '--rm', '--pull=never', '--network', prefix, '--read-only',
           '--tmpfs=/tmp:size=64m,mode=1777', '-e', 'PGDIRECT_URL='+database,
           image, 'node', 'run-packaged-migrations.cjs')
    print('PASS packaged canonical migrations', flush=True)
    ids = []
    for kind in ['api', 'worker', 'web']:
        name = prefix + '-' + kind
        owned.append(name)
        command = ['node', 'worker/dist/main.js'] if kind == 'worker' else []
        selected = web_image if kind == 'web' else image
        docker('run', '-d', '--pull=never', '--name', name, '--network', prefix, '--read-only',
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
        assert info['Config']['Env'].count('NODE_OPTIONS='+node_options) == 1
        assert not any(arg.startswith('--inspect') for arg in info['Args'])
        if kind != 'web':
            ids.append(info['Image'])
        eventually(lambda: health(name))
        assert docker('exec', name, 'node', '-e',
                      'require("node:fs").writeFileSync("/app/must-not-write","x")', check=False).returncode != 0
    assert ids[0] == ids[1]
    print('PASS identical image starts API and worker by command override; non-root/read-only readiness', flush=True)
    api, worker, web = [prefix+'-'+k for k in ['api', 'worker', 'web']]
    for name, port in ((api, 4000), (worker, 9090), (web, 3000)):
        check_node_security(name, port)
    print('PASS non-root UID/GID, inspector closed and strict HTTP parser in API/worker/web', flush=True)
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
