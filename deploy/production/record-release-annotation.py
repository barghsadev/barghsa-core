#!/usr/bin/env python3
"""Publish a Grafana release marker from a completed guarded-rollout receipt."""

import argparse
from hashlib import sha256
from html import escape
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlencode, urlsplit
from urllib.request import ProxyHandler, Request, build_opener

from release_evidence import (LIMIT, NoRedirect, ReleaseEvidenceError, checked_checkout,
                              completed_rollout, protected_file, publish_once, require)

TAG = 'barghsa-release'


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
    fingerprint = sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return publish_once(state_path, fingerprint, lambda: annotation_id(request, payload, identity),
                        lambda: request(payload=payload), 'grafana_marker')


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
    except ReleaseEvidenceError as error:
        print(str(error), file=sys.stderr)
    except (OSError, TypeError, KeyError, ValueError, RecursionError, subprocess.SubprocessError):
        print('grafana_release_marker_unavailable', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
