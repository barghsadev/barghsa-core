#!/usr/bin/env python3
"""Run bounded, authenticated OWASP ZAP checks against a staging release."""

import argparse
from collections import Counter
from dataclasses import dataclass, field
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import time
from urllib.parse import urlencode
from uuid import uuid4


HOST = 'stg.barghsa.com'
ORIGIN = f'https://{HOST}'
IMAGE = 'ghcr.io/zaproxy/zaproxy@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af'
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
MAX_JSON = 2 * 1024 * 1024


class ScanError(Exception):
    """A diagnostic safe to print without upstream or fixture contents."""


@dataclass(frozen=True)
class Fixture:
    session: str = field(repr=False)
    user_id: str
    username: str
    profile_id: str


def load_fixture(path):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as handle:
        info = os.fstat(handle.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or info.st_mode & 0o077 or info.st_size > 4096):
            raise ScanError('The fixture must be a private file owned by the runner')
        values = json.load(handle)
    fixture = Fixture(**values)
    if (not all(isinstance(value, str) and UUID.fullmatch(value)
                for value in (fixture.session, fixture.user_id, fixture.profile_id))
            or not isinstance(fixture.username, str)
            or not re.fullmatch(r'barghsa-dast-[a-z0-9]{8,32}@example\.test', fixture.username)):
        raise ScanError('The fixture must identify a dedicated synthetic customer')
    return fixture


def json_response(connection, method, path, body=None, headers=None):
    try:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        if response.status != 200:
            raise ScanError(f'Unexpected control HTTP status {response.status}')
        data = response.read(MAX_JSON + 1)
        if len(data) > MAX_JSON:
            raise ScanError('Control response exceeded the size limit')
        return json.loads(data)
    finally:
        connection.close()


def staging_release(commit):
    result = json_response(http.client.HTTPSConnection(HOST, timeout=8), 'GET', '/release.json')
    if result.get('commit') != commit or not re.fullmatch(r'\d+\.\d+\.\d+', result.get('version', '')):
        raise ScanError('Live staging metadata does not match the expected release SHA')
    return result['version']


class Zap:
    def __init__(self, port, key):
        self.port = port
        self.key = key

    def call(self, path, params=None):
        # POST keeps the intercepted Cookie header out of the control URL.
        body = urlencode(params) if params is not None else None
        return json_response(
            http.client.HTTPConnection('127.0.0.1', self.port, timeout=15),
            'POST' if body is not None else 'GET', f'http://zap/JSON/{path}/', body,
            {'Host': 'zap', 'X-ZAP-API-Key': self.key,
             'Content-Type': 'application/x-www-form-urlencoded'},
        )

    def get(self, path, fixture=None):
        cookie = '' if fixture is None else f'Cookie: barghsa_session={fixture.session}\r\n'
        request = f'GET {ORIGIN}{path} HTTP/1.1\r\nHost: {HOST}\r\nAccept: application/json\r\n{cookie}\r\n'
        receipt = self.call('core/action/sendRequest', {'request': request, 'followRedirects': 'false'})
        messages = receipt.get('sendRequest')
        if not isinstance(messages, list) or len(messages) != 1:
            raise ScanError('ZAP returned an unexpected request receipt')
        message = messages[0]
        status = re.match(r'HTTP/\d(?:\.\d)? ([1-5]\d\d)\b', message.get('responseHeader', ''))
        if not status:
            raise ScanError('ZAP did not record an HTTP response')
        return int(status[1]), json.loads(message['responseBody'])


def scan(zap, fixture):
    scanner = zap.call('core/view/version').get('version', '')
    if not re.fullmatch(r'\d+\.\d+\.\d+', scanner):
        raise ScanError('Unexpected ZAP version')
    rules = zap.call('pscan/view/scanners')['scanners']
    if not any(str(rule.get('enabled')).lower() == 'true' for rule in rules):
        raise ScanError('ZAP has no enabled passive scan rules')
    profile = urlencode({'profileId': fixture.profile_id})
    probes = [
        ('anonymous_session', '/api/auth/user', 401, None),
        ('authenticated_session', '/api/auth/user', 200, fixture),
        ('profiles', '/api/profiles', 200, fixture),
        ('electricity_orders', '/api/orders', 200, fixture),
        ('unknown_order', f'/api/orders/{uuid4()}', 404, fixture),
        ('saving_orders', f'/api/saving/orders?{profile}', 200, fixture),
        ('solar_requests', f'/api/solar/requests?{profile}', 200, fixture),
        ('consultation_requests', f'/api/consultations/requests?{profile}', 200, fixture),
    ]
    receipts = []
    for name, path, expected, actor in probes:
        status, body = zap.get(path, actor)
        if status != expected:
            raise ScanError(f'{name} returned HTTP {status}, expected {expected}')
        if name == 'authenticated_session' and (
            body.get('userId') != fixture.user_id or body.get('username') != fixture.username
            or body.get('isStaff') is not False or body.get('operatingContext') != 'customer'
        ):
            raise ScanError('ZAP did not reach the authorized synthetic customer session')
        if name == 'profiles' and [row.get('id') for row in body['profiles']] != [fixture.profile_id]:
            raise ScanError('ZAP did not read exactly the dedicated synthetic profile')
        if name == 'unknown_order' and body.get('error', {}).get('code') != 'NOT_FOUND:RESOURCE':
            raise ScanError('The unknown order did not return the opaque resource error')
        receipts.append({'probe': name, 'status': status})

    deadline = time.monotonic() + 90
    while int(zap.call('pscan/view/recordsToScan')['recordsToScan']) != 0:
        if time.monotonic() >= deadline:
            raise ScanError('ZAP passive scan did not finish')
        time.sleep(1)

    alerts = zap.call('alert/view/alerts', {'baseurl': ORIGIN, 'start': 0, 'count': 501})['alerts']
    if len(alerts) > 500:
        raise ScanError('ZAP alert count exceeded the report limit')
    findings = Counter()
    for alert in alerts:
        rule, risk = alert.get('pluginId'), alert.get('risk')
        if not isinstance(rule, str) or not re.fullmatch(r'\d{1,8}', rule) or risk not in {
            'Informational', 'Low', 'Medium', 'High'
        }:
            raise ScanError('Unexpected ZAP alert format')
        findings[rule, risk] += 1
    return {
        'scanner': scanner, 'mode': 'passive_with_authenticated_probes', 'probes': receipts,
        'findings': [{'rule': rule, 'risk': risk, 'count': count}
                     for (rule, risk), count in sorted(findings.items())],
    }


def run_zap(fixture):
    container = f'barghsa-staging-dast-{secrets.token_hex(6)}'
    key = secrets.token_hex(24)
    try:
        subprocess.run([
            'docker', 'run', '--detach', '--rm', '--name', container,
            '--publish', '127.0.0.1::8080', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--memory', '1g', '--pids-limit', '256',
            IMAGE, 'zap.sh', '-daemon', '-silent', '-host', '0.0.0.0', '-port', '8080',
            '-config', f'api.key={key}', '-config', 'api.addrs.addr.name=.*',
            '-config', 'api.addrs.addr.regex=true',
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=240)
        binding = subprocess.check_output(['docker', 'port', container, '8080/tcp'], text=True, timeout=10).strip()
        address = re.fullmatch(r'127\.0\.0\.1:(\d+)', binding)
        if not address:
            raise ScanError('ZAP control endpoint is not bound to loopback')
        zap = Zap(int(address[1]), key)
        for _ in range(60):
            try:
                zap.call('core/view/version')
                break
            except (ConnectionError, TimeoutError, http.client.HTTPException):
                time.sleep(1)
        else:
            raise ScanError('ZAP did not become ready')
        return scan(zap, fixture)
    finally:
        subprocess.run(['docker', 'rm', '-f', container], check=False, timeout=15,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        remaining = subprocess.check_output([
            'docker', 'ps', '--all', '--filter', f'name=^/{container}$', '--format', '{{.Names}}'
        ], text=True, timeout=10, stderr=subprocess.DEVNULL)
        if remaining.strip():
            raise ScanError('The temporary ZAP container requires cleanup')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--fixture', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    try:
        if not re.fullmatch(r'[0-9a-f]{40}', args.commit):
            raise ScanError('Provide the full staging release commit SHA')
        fixture = load_fixture(args.fixture)
        version = staging_release(args.commit)
        report = run_zap(fixture)
        if staging_release(args.commit) != version:
            raise ScanError('Staging changed while ZAP was running')
        report.update(origin=ORIGIN, version=version, commit=args.commit, image=IMAGE)
        with os.fdopen(os.open(args.report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as output:
            json.dump(report, output, indent=2)
            output.write('\n')
        print(f'ZAP scanned {len(report["probes"])} staging API probes for {args.commit}')
        return int(any(item['risk'] == 'High' for item in report['findings']))
    except ScanError as error:
        print(f'DAST failed: {error}', file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, http.client.HTTPException,
            subprocess.SubprocessError):
        print('DAST failed: fixture, scanner, release metadata or report could not be verified', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main())
