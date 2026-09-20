#!/usr/bin/env python3
"""Exercise the committed pilot config without host ports or production certificates."""
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

root=Path(__file__).resolve().parents[1]
def run(*args):
    result=subprocess.run(args,capture_output=True,text=True)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.strip()}")
    return result.stdout

backend='barghsa-proxy-backend-'+uuid.uuid4().hex[:10]
proxy='barghsa-proxy-'+uuid.uuid4().hex[:10]
try:
    with tempfile.TemporaryDirectory(prefix='barghsa-proxy-cert-') as directory:
        cert=Path(directory)
        run('openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=barghsa.example.com',
            '-keyout',str(cert/'key.pem'),'-out',str(cert/'cert.pem'))
        run('docker','run','-d','--name',backend,'--network','none',
            '-v',f'{root}/scripts/proxy-fixture.mjs:/fixture.mjs:ro',
            '-v',f'{root}/scripts/check-pilot-proxy.mjs:/check.mjs:ro',
            'node:22-bookworm','node','/fixture.mjs')
        for _ in range(100):
            if 'ready' in run('docker','logs',backend): break
            time.sleep(.1)
        else: raise RuntimeError('Fixture did not start')
        mounts=['-v',f'{root}/deploy/pilot/nginx.conf:/etc/nginx/nginx.conf:ro',
            '-v',f'{cert}/cert.pem:/etc/ssl/certs/barghsa.pem:ro','-v',f'{cert}/key.pem:/etc/ssl/private/barghsa.key:ro']
        run('docker','run','--rm',*mounts,'nginx:1.27-alpine','nginx','-t')
        run('docker','run','-d','--name',proxy,'--network',f'container:{backend}',*mounts,'nginx:1.27-alpine')
        # A failed config/start remains an error rather than a skipped probe.
        for _ in range(100):
            probe=subprocess.run(['docker','exec',backend,'node','-e',
                "require('net').connect(443,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"],capture_output=True)
            if probe.returncode==0: break
            time.sleep(.1)
        else: raise RuntimeError('Proxy did not start')
        print(run('docker','exec',backend,'node','/check.mjs'),end='')
finally:
    for container in [proxy,backend]:
        subprocess.run(['docker','rm','-f',container],capture_output=True)
