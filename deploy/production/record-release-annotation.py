#!/usr/bin/env python3
"""Publish a Grafana release marker from a completed guarded-rollout receipt."""

import argparse
from contextlib import contextmanager
import fcntl
from hashlib import sha256
from html import escape
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


ROOT = Path(__file__).resolve().parents[2]
LIMIT = 65536
TAG = 'barghsa-release'


class AnnotationError(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise AnnotationError(reason)


@contextmanager
def protected_file(path, *, state=False):
    flags = os.O_RDWR | os.O_CREAT if state else os.O_RDONLY
    mode = 'r+b' if state else 'rb'
    with os.fdopen(os.open(path, flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600), mode) as file:
        info = os.fstat(file.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o077,
                'unsafe_annotation_file')
        yield file


def bounded_json(file):
    raw = file.readline(LIMIT + 1)
    require(len(raw) <= LIMIT, 'annotation_input_too_large')
    if not raw:
        return None
    value = json.loads(raw)
    require(raw.endswith(b'\n') and isinstance(value, dict), 'rollout_receipt_invalid')
    return value


def checked_checkout():
    def git(*args):
        return subprocess.check_output(['git', '-C', str(ROOT), *args],
                                       text=True, stderr=subprocess.DEVNULL, timeout=5)

    commit = git('rev-parse', 'HEAD').strip()
    require(re.fullmatch(r'[a-f0-9]{40}', commit), 'release_checkout_invalid')
    version = json.loads(git('show', commit + ':package.json'))['version']
    require(re.fullmatch(r'\d+\.\d+\.\d+', version), 'release_checkout_invalid')
    git('cat-file', '-e', f'{commit}:releases/{version}.md')
    return commit, version


def completed_rollout(receipt, commit, scope):
    with protected_file(receipt) as file:
        plan = bounded_json(file)
        require(isinstance(plan, dict) and plan.get('event') == 'plan' and plan.get('scope') == scope
                and isinstance(plan.get('candidate'), dict) and plan['candidate'].get('commit') == commit,
                'rollout_identity_mismatch')
        previous, last, cutover = None, plan, None
        while (row := bounded_json(file)) is not None:
            require(last.get('event') != 'completed'
                    and row.get('event') not in ('halted', 'rolled_back', 'rollback_unverified'),
                    'rollout_not_completed')
            if row.get('event') == 'traffic_verified' and row.get('weight') == 100:
                cutover = row.get('recorded_at')
            previous, last = last, row
    require(last.get('event') == 'completed' and last.get('weight') == 100 and previous is not None
            and previous.get('event') == 'observation' and previous.get('weight') == 100
            and previous.get('ready') is True and type(cutover) in (int, float)
            and type(previous.get('recorded_at')) in (int, float)
            and type(last.get('recorded_at')) in (int, float)
            and 0 < cutover <= previous['recorded_at'] <= last['recorded_at'] <= time.time(),
            'rollout_not_completed')
    return int(cutover * 1000), last['recorded_at']


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def grafana_request(origin, token):
    parsed = urlsplit(origin)
    require(parsed.hostname and parsed.username is None and not parsed.path and not parsed.query
            and not parsed.fragment and not re.search(r'\s', origin)
            and (parsed.scheme == 'https' or (parsed.scheme == 'http'
                 and parsed.hostname in ('127.0.0.1', '::1'))), 'grafana_origin_invalid')
    opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(query='', payload=None):
        headers = {'Accept': 'application/json', 'Authorization': 'Bearer ' + token}
        body = None
        if payload is not None:
            headers['Content-Type'] = 'application/json'
            body = json.dumps(payload).encode()
        with opener.open(Request(origin + '/api/annotations' + query, body, headers), timeout=5) as response:
            require(response.headers.get_content_type() == 'application/json', 'grafana_response_invalid')
            content = response.read(LIMIT + 1)
        require(len(content) <= LIMIT, 'grafana_response_too_large')
        return json.loads(content)

    return request


def annotation_id(request, payload, identity):
    query = '?' + urlencode([('type', 'annotation'), ('tags', TAG), ('tags', identity), ('limit', '2')])
    rows = request(query)
    require(isinstance(rows, list) and len(rows) < 2, 'grafana_marker_conflict')
    if not rows:
        return None
    marker = rows[0]
    require(isinstance(marker, dict) and type(marker.get('id')) is int and marker['id'] > 0
            and marker.get('time') == payload['time'] and marker.get('text') == payload['text']
            and set(marker.get('tags', [])) == set(payload['tags'])
            and not marker.get('dashboardUID') and not marker.get('panelId'), 'grafana_marker_conflict')
    return marker['id']


def publish(request, payload, identity, state_path):
    fingerprint = sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest().encode() + b'\n'
    directory = state_path.parent.stat()
    require(directory.st_uid == os.geteuid() and not directory.st_mode & 0o022,
            'unsafe_annotation_directory')
    with protected_file(state_path, state=True) as state:
        fcntl.flock(state, fcntl.LOCK_EX | fcntl.LOCK_NB)
        pending = state.read(LIMIT + 1)
        require(not pending or pending == fingerprint, 'grafana_marker_state_conflict')
        found = annotation_id(request, payload, identity)
        if found is not None:
            return found
        require(not pending, 'grafana_marker_delivery_unconfirmed')
        state.write(fingerprint)
        state.flush()
        os.fsync(state.fileno())
        directory_fd = os.open(state_path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        try:
            request(payload=payload)
        except (AnnotationError, OSError, ValueError):
            pass
        found = annotation_id(request, payload, identity)
        require(found is not None, 'grafana_marker_delivery_unconfirmed')
        return found


def publish_release(config_path, receipt):
    with protected_file(config_path) as source:
        raw = source.read(LIMIT + 1)
    require(len(raw) <= LIMIT, 'annotation_input_too_large')
    config = json.loads(raw)
    scope = config['scope']
    require(isinstance(scope, dict) and set(scope) == {'environment', 'database'}
            and all(re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', value) for value in scope.values()),
            'grafana_scope_invalid')
    for field, limit in (('owner', 120), ('summary', 800)):
        value = config[field]
        require(0 < len(value) <= limit and value == value.strip()
                and not re.search(r'[\x00-\x1f\x7f]', value), 'grafana_release_metadata_invalid')
    token = config['token']
    require(re.fullmatch(r'[!-~]{16,1024}', token), 'grafana_token_invalid')
    commit, version = checked_checkout()
    when, completed_at = completed_rollout(receipt, commit, scope)
    key = sha256(json.dumps([scope, commit, when, completed_at], sort_keys=True).encode()).hexdigest()
    identity = 'release-id:' + key
    notes = f'https://github.com/barghsadev/barghsa-core/blob/{commit}/releases/{version}.md'
    text = (f'Barghsa v{version} · {commit}\n\nOwner: {escape(config["owner"])}\n\n'
            f'{escape(config["summary"])}\n\n{notes}')
    payload = {'time': when, 'text': text,
               'tags': [TAG, identity, 'environment:' + scope['environment'], 'database:' + scope['database']]}
    request = grafana_request(config['origin'], token)
    state_path = receipt.parent / ('.grafana-release-' + key)
    found = publish(request, payload, identity, state_path)
    return {'status': 'verified', 'annotation_id': found, 'scope': scope, 'commit': commit,
            'version': version, 'time_ms': when, 'release_id': key}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--receipt', required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(publish_release(args.config, args.receipt)))
        return 0
    except AnnotationError as error:
        print(str(error), file=sys.stderr)
    except (OSError, TypeError, KeyError, ValueError, RecursionError, subprocess.SubprocessError):
        print('grafana_release_marker_unavailable', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
