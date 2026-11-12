#!/usr/bin/env python3
"""Exercise the committed pilot config without host ports or production certificates."""
from pathlib import Path
import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
import uuid

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--profile', choices=['pilot', 'staging'], default='pilot')
profile=parser.parse_args().profile
def run(*args):
    result=subprocess.run(args,capture_output=True,text=True)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.strip()}")
    return result.stdout

backend='barghsa-proxy-backend-'+uuid.uuid4().hex[:10]
proxy='barghsa-proxy-'+uuid.uuid4().hex[:10]

def start_proxy(mounts):
    run('docker','run','--rm',*mounts,'nginx:1.27-alpine','nginx','-t')
    run('docker','run','-d','--name',proxy,'--network',f'container:{backend}',*mounts,'nginx:1.27-alpine')
    for _ in range(100):
        probe=subprocess.run(['docker','exec',backend,'node','-e',
            "require('net').connect(443,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"],capture_output=True)
        if probe.returncode==0: return
        time.sleep(.1)
    raise RuntimeError('Proxy did not start')

try:
    with tempfile.TemporaryDirectory(prefix='barghsa-proxy-cert-') as directory:
        cert=Path(directory)
        run('openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=barghsa.example.com',
            '-addext','subjectAltName=DNS:barghsa.example.com,DNS:stg.barghsa.com',
            '-keyout',str(cert/'key.pem'),'-out',str(cert/'cert.pem'))
        run('docker','run','-d','--name',backend,'--network','none',
            '-v',f'{root}/scripts/proxy-fixture.mjs:/fixture.mjs:ro',
            '-v',f'{root}/scripts/check-{profile}-proxy.mjs:/check.mjs:ro',
            '-v',f'{root}/scripts/check-proxy-tls.mjs:/tls-check.mjs:ro',
            '-v',f'{cert}/cert.pem:/fixture-ca.pem:ro',
            'node:22-bookworm','node','/fixture.mjs')
        for _ in range(100):
            if 'ready' in run('docker','logs',backend): break
            time.sleep(.1)
        else: raise RuntimeError('Fixture did not start')
        if profile == 'pilot':
            mounts=['-v',f'{root}/deploy/pilot/nginx.conf:/etc/nginx/nginx.conf:ro',
                '-v',f'{cert}/cert.pem:/etc/ssl/certs/barghsa.pem:ro','-v',f'{cert}/key.pem:/etc/ssl/private/barghsa.key:ro']
        else:
            mounts=['-v',f'{root}/deploy/staging/nginx.conf:/etc/nginx/conf.d/default.conf:ro',
                '-v',f'{root}/deploy/staging/nginx-api-proxy.conf:/etc/nginx/snippets/barghsa-api-proxy.conf:ro',
                '-v',f'{root}/deploy/staging/nginx-s3-proxy.conf:/etc/nginx/snippets/barghsa-s3-proxy.conf:ro',
                '-v',f'{cert}/cert.pem:/etc/letsencrypt/live/stg.barghsa.com/fullchain.pem:ro',
                '-v',f'{cert}/key.pem:/etc/letsencrypt/live/stg.barghsa.com/privkey.pem:ro']
        start_proxy(mounts)
        print(run('docker','exec',backend,'node','/check.mjs'),end='')
        run('docker', 'exec', backend, 'node', '-e', '''
const assert = require('node:assert/strict');
const https = require('node:https');
const marker = 'barghsa-private-log-probe';
function request(method, extraHeaders) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: '127.0.0.1', port: 443, rejectUnauthorized: false, method,
      path: `/api/${marker}?authority=${marker}`,
      headers: {
        'User-Agent': marker, 'X-Forwarded-For': marker,
        Referer: `https://example.test/${marker}`, Authorization: `Bearer ${marker}`,
        ...extraHeaders,
      },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Privacy probe timed out')));
    req.end();
  });
}
(async () => {
  assert.equal(await request('PATCH', {}), 200);
  assert.equal(await request('POST', { 'Content-Length': 70000000 }), 413);
})().catch((error) => { console.error(error); process.exitCode = 1; });
''')
        logs = subprocess.run(['docker', 'logs', proxy], check=True, capture_output=True, text=True)
        if 'barghsa-private-log-probe' in logs.stdout + logs.stderr:
            raise RuntimeError('Proxy logs exposed the private request marker')
        records = [json.loads(line) for line in logs.stdout.splitlines() if line.startswith('{"timestamp":')]
        outcomes = {(row['method'], row['route'], row['status']) for row in records}
        if not {('PATCH', '/api', '200'), ('POST', '/api', '413')} <= outcomes:
            raise RuntimeError('Proxy logs omitted a privacy probe outcome')
        expected_environment = 'production' if profile == 'pilot' else 'staging'
        for row in records:
            if row['service'] != 'web' or row['environment'] != expected_environment:
                raise RuntimeError('Proxy log service or deployment environment is invalid')
        accepted = next(row for row in records if row['method'] == 'PATCH' and row['status'] == '200')
        rejected = next(row for row in records if row['method'] == 'POST' and row['status'] == '413')
        if accepted['level'] != 'info' or accepted['correlationId'] != '01900000-0000-7000-8000-000000000001':
            raise RuntimeError('Proxy log lost the API correlation ID')
        if rejected['level'] != 'warn' or not re.fullmatch(r'[0-9a-f]{32}', rejected['correlationId']):
            raise RuntimeError('Proxy log lost the generated ID for a rejected edge request')
        print('PASS private proxy logs retain correlated success and request-rejection outcomes')
        hostname = 'barghsa.example.com' if profile == 'pilot' else 'stg.barghsa.com'
        print(run('docker', 'exec', backend, 'node', '/tls-check.mjs', hostname, 'default'), end='')
        if profile == 'pilot':
            renderer = [sys.executable, str(root / 'deploy/pilot/render-nginx.py')]
            default = subprocess.run(renderer, env={}, check=True, capture_output=True).stdout
            if default != (root / 'deploy/pilot/nginx.conf').read_bytes():
                raise RuntimeError('Default rendering changed the pilot configuration')
            environment = {'BARGHSA_PILOT_HSTS': 'true', 'BARGHSA_DEPLOYMENT_ENV': 'staging'}
            rejected = subprocess.run(renderer, env=environment, capture_output=True)
            if rejected.returncode != 1 or rejected.stdout or b'requires the production' not in rejected.stderr:
                raise RuntimeError('Renderer did not reject staging HSTS')
            environment['BARGHSA_DEPLOYMENT_ENV'] = 'production'
            rendered = cert / 'nginx-production-test.conf'
            with rendered.open('wb') as output:
                subprocess.run(renderer, env=environment, check=True, stdout=output)
            run('docker', 'rm', '-f', proxy)
            mounts[1] = f'{rendered}:/etc/nginx/nginx.conf:ro'
            start_proxy(mounts)
            print(run('docker', 'exec', backend, 'node', '/tls-check.mjs', hostname, 'hsts'), end='')
finally:
    for container in [proxy,backend]:
        subprocess.run(['docker','rm','-f',container],capture_output=True)
