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
release_revision = 'a' * 40
release_logging = {'driver': 'json-file', 'options': {'labels': 'org.opencontainers.image.revision'}}


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
        fixture = Path(temporary)
        runtime = fixture / 'runtime.env'
        pilot = fixture / 'pilot-compose.env'
        backup_key = fixture / 'backup-key'
        backup_key.write_text('synthetic-only\n')
        runtime_values = dict(DATABASE_URL='postgresql://test:synthetic@pgbouncer:6432/barghsa',
                              APP_PUBLIC_URL='https://app.example.test', API_PUBLIC_URL='https://app.example.test',
                              PAYMENT_GATEWAY_MERCHANT_ID='synthetic-only', AUTH_DELIVERY_ENCRYPTION_KEY='11'*32)
        pilot_values = dict(POSTGRES_PASSWORD='pilot-db-test-only',
                            MINIO_ACCESS_KEY='pilot-storage-test', MINIO_SECRET_KEY='pilot-storage-test-only',
                            BACKUP_CLUSTER_ID='pilot-test',
                            BACKUP_GPG_PASSPHRASE_FILE=str(backup_key),
                            BACKUP_S3_ENDPOINT='https://off-host.example.test',
                            BACKUP_S3_BUCKET='pilot-test-backups',
                            BACKUP_S3_REGION='eu-central-1',
                            BACKUP_S3_ACCESS_KEY='pilot-backup-test',
                            BACKUP_S3_SECRET_KEY='pilot-backup-test-only',
                            BACKUP_S3_SESSION_TOKEN='pilot-temporary-token',
                            BACKUP_ALLOW_HTTP='true')
        runtime.write_text('\n'.join(f'{k}={v}' for k, v in runtime_values.items())
                           + f'\nNODE_OPTIONS={unsafe_node_options}\n')
        env = {k: v for k, v in os.environ.items() if k not in
               {*runtime_values, *pilot_values, 'COMPOSE_PROFILES', 'REDIS_URL', 'BARGHSA_RELEASE_SHA'}}
        env['BARGHSA_RUNTIME_ENV_FILE'] = str(runtime)

        def resolve(values, *options):
            pilot.write_text('\n'.join(f'{k}={v}' for k, v in values.items())
                             + f'\nBARGHSA_RELEASE_SHA={release_revision}\n')
            return subprocess.run(
                ['docker', 'compose', '--env-file', str(runtime), '--env-file', str(pilot),
                 '-f', 'docker-compose.yml', '-f', 'docker-compose.prod.yml', *options,
                 'config', '--format', 'json'], capture_output=True, text=True, env=env,
                cwd=Path(__file__).resolve().parents[1],
            )

        default = resolve(pilot_values)
        assert default.returncode == 0, default.stderr
        assert 'redis' not in json.loads(default.stdout)['services']
        enabled = resolve({**pilot_values, 'REDIS_URL': 'redis://redis:6379'}, '--profile', 'cache')
        assert enabled.returncode == 0, enabled.stderr
        config = json.loads(enabled.stdout)
        services = config['services']
        assert 'pgbouncer' in services
        assert services['api']['build'] == services['worker']['build'] == services['ai-inference']['build']
        assert services['worker']['command'] == ['node', 'worker/dist/main.js']
        for name in ['api', 'worker', 'web', 'ai-inference']:
            service = services[name]
            assert service['read_only'] and service['cap_drop'] == ['ALL']
            assert 'no-new-privileges:true' in service['security_opt']
            assert service['environment']['NODE_OPTIONS'] == node_options, name
            assert service['build']['args']['BARGHSA_RELEASE_SHA'] == release_revision, name
            assert service['logging'] == release_logging, name
        assert services['api']['healthcheck']['test'] == ['CMD', 'node', 'healthcheck-runtime.cjs']
        published = {
            name: {(p['host_ip'], p['target'], p['published']) for p in service['ports']}
            for name, service in services.items() if service.get('ports')
        }
        assert published == {
            'api': {('127.0.0.1', 4000, '4000')},
            'web': {('127.0.0.1', 3000, '3000')},
            'minio': {('127.0.0.1', 9000, '9000'), ('127.0.0.1', 9001, '9001')},
        }
        assert services['api']['environment']['REDIS_URL'] == 'redis://redis:6379'
        postgres = services['postgres']
        assert postgres['healthcheck']['test'] == ['CMD', 'pg_isready', '-h', '127.0.0.1', '-U', 'barghsa']
        assert postgres['command'][-2:] == ['-c', 'archive_mode=on']
        assert 'pgdata' in {v.get('source') for v in postgres['volumes']}
        assert postgres['environment']['POSTGRES_PASSWORD'] == pilot_values['POSTGRES_PASSWORD']
        assert services['pgbouncer']['environment']['POSTGRESQL_PASSWORD'] == pilot_values['POSTGRES_PASSWORD']
        assert services['minio']['environment']['MINIO_ROOT_PASSWORD'] == pilot_values['MINIO_SECRET_KEY']
        assert services['minio-init']['environment']['MINIO_SECRET_KEY'] == pilot_values['MINIO_SECRET_KEY']
        for key in ['BACKUP_CLUSTER_ID', 'BACKUP_S3_ENDPOINT', 'BACKUP_S3_BUCKET', 'BACKUP_S3_REGION',
                    'BACKUP_S3_ACCESS_KEY', 'BACKUP_S3_SECRET_KEY', 'BACKUP_S3_SESSION_TOKEN']:
            assert postgres['environment'][key] == pilot_values[key], key
        assert postgres['environment']['BACKUP_ALLOW_HTTP'] == 'false'
        assert postgres['environment']['BACKUP_GPG_PASSPHRASE_FILE'] == '/run/secrets/postgres_backup_key'
        assert {s['source'] for s in postgres['secrets']} == {'postgres_backup_key'}
        assert config['secrets']['postgres_backup_key']['file'] == str(backup_key)
        for name in ['api', 'worker', 'ai-inference', 'web']:
            assert not set(pilot_values) & services[name]['environment'].keys(), name
        for required in sorted(set(pilot_values) - {'BACKUP_S3_REGION', 'BACKUP_S3_SESSION_TOKEN',
                                                    'BACKUP_ALLOW_HTTP'}):
            failure = resolve({**pilot_values, required: ''})
            assert failure.returncode != 0 and required in failure.stderr, required
    print('PASS pilot Compose: app hardening, private services, protected inputs, encrypted WAL and release logging', flush=True)


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
        for name in ('api', 'worker', 'ai-inference', 'migrate', 'web'):
            assert services[name]['logging'] == release_logging, name
    print('PASS hybrid Compose enforces runtime Node flags and release logging', flush=True)


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
