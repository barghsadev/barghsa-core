#!/usr/bin/env python3
"""Publish and verify a Sentry deployment marker after a guarded production rollout."""

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import ProxyHandler, Request, build_opener

from release_evidence import (LIMIT, NoRedirect, ReleaseEvidenceError, checked_checkout,
                              completed_rollout, protected_file, publish_once, require)


REPOSITORY = 'barghsadev/barghsa-core'
SENTRY_ORIGINS = {'https://sentry.io', 'https://us.sentry.io', 'https://de.sentry.io'}
RESPONSE_LIMIT = 1024 * 1024


def read_config(path):
    with protected_file(path) as source:
        raw = source.read(LIMIT + 1)
    require(len(raw) <= LIMIT, 'sentry_config_too_large')
    config = json.loads(raw)
    organization, projects, scope = config['organization'], config['projects'], config['scope']
    slug = r'[a-z0-9][a-z0-9_-]{0,63}'
    require(isinstance(organization, str) and re.fullmatch(slug, organization)
            and isinstance(projects, list) and projects
            and all(isinstance(project, str) and re.fullmatch(slug, project) for project in projects)
            and len(set(projects)) == len(projects), 'sentry_projects_invalid')
    require(config['origin'] in SENTRY_ORIGINS, 'sentry_origin_invalid')
    require(isinstance(config['token'], str) and re.fullmatch(r'[!-~]{16,1024}', config['token']),
            'sentry_token_invalid')
    require(isinstance(scope, dict) and set(scope) == {'environment', 'database'}
            and scope['environment'] == 'production'
            and isinstance(scope['database'], str)
            and re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}', scope['database']),
            'sentry_production_scope_invalid')
    return config


def next_cursor(link):
    if not link:
        return None
    for part in link.split(','):
        url, closing, parameters = part.strip().partition('>')
        attributes = dict(re.findall(r';\s*([a-z]+)="([^"]*)"', parameters))
        if attributes.get('rel') != 'next':
            continue
        require(closing and url.startswith('<'), 'sentry_pagination_invalid')
        if attributes.get('results') == 'false':
            return None
        # Reuse only the cursor. Never follow a URL from an API response.
        values = parse_qs(urlsplit(url[1:]).query).get('cursor', [])
        require(attributes.get('results') == 'true' and len(values) == 1
                and re.fullmatch(r'-?\d{1,20}:\d{1,20}:0', values[0]), 'sentry_pagination_invalid')
        return values[0]
    raise ReleaseEvidenceError('sentry_pagination_invalid')


def sentry_request(origin, token):
    opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(path, cursor=None, payload=None):
        headers = {'Accept': 'application/json', 'Authorization': 'Bearer ' + token}
        body = None
        if payload is not None:
            headers['Content-Type'] = 'application/json'
            body = json.dumps(payload).encode()
        query = '?' + urlencode({'cursor': cursor}) if cursor else ''
        with opener.open(Request(origin + path + query, body, headers), timeout=5) as response:
            require(response.headers.get_content_type() == 'application/json', 'sentry_response_invalid')
            content = response.read(RESPONSE_LIMIT + 1)
            cursor = next_cursor(response.headers.get('Link')) if body is None else None
        require(len(content) <= RESPONSE_LIMIT, 'sentry_response_too_large')
        return json.loads(content), cursor

    return request


def list_rows(request, path):
    cursor, seen = None, set()
    for _ in range(20):
        rows, cursor = request(path, cursor=cursor)
        require(isinstance(rows, list) and all(isinstance(row, dict) for row in rows),
                'sentry_response_invalid')
        yield from rows
        if cursor is None:
            return
        require(cursor not in seen, 'sentry_pagination_invalid')
        seen.add(cursor)
    raise ReleaseEvidenceError('sentry_pagination_limit')


def verify_release_commits(request, organization, projects, commit):
    for project in projects:
        path = f'/api/0/projects/{organization}/{project}/releases/{commit}/commits/'
        require(any(row.get('id') == commit and isinstance(row.get('repository'), dict)
                    and row['repository'].get('name') == REPOSITORY for row in list_rows(request, path)),
                'sentry_release_commit_unverified')


def release_request(config, commit):
    request = sentry_request(config['origin'], config['token'])
    verify_release_commits(request, config['organization'], config['projects'], commit)
    return request


def deployment_time(value):
    parsed = datetime.fromisoformat(value.removesuffix('Z') + '+00:00' if value.endswith('Z') else value)
    require(parsed.utcoffset() is not None, 'sentry_deploy_time_invalid')
    return parsed


def deploy_id(request, path, payload):
    rows = list(list_rows(request, path))
    matching = [row for row in rows if row.get('name') == payload['name']]
    require(len(matching) <= 1, 'sentry_marker_conflict')
    if not matching:
        # Sentry's deploy list exposes the latest deployment per project and
        # environment. A later rollout may have displaced this receipt.
        require(not any(row.get('environment') == payload['environment']
                        and deployment_time(row['dateFinished']) >= deployment_time(payload['dateFinished'])
                        for row in rows), 'sentry_marker_superseded')
        return None
    marker = matching[0]
    require(isinstance(marker.get('id'), str) and re.fullmatch(r'[1-9]\d{0,19}', marker['id'])
            and marker.get('environment') == payload['environment'] and marker.get('url') == payload['url']
            and all(deployment_time(marker[field]) == deployment_time(payload[field])
                    for field in ('dateStarted', 'dateFinished')), 'sentry_marker_conflict')
    return marker['id']


def record_deploy(config_path, receipt):
    config = read_config(config_path)
    scope, organization, projects = config['scope'], config['organization'], sorted(config['projects'])
    commit, version = checked_checkout()
    cutover, finished = completed_rollout(receipt, commit, scope)
    request = release_request(config, commit)
    key = sha256(json.dumps([scope, commit, cutover, finished], sort_keys=True).encode()).hexdigest()
    target = sha256(json.dumps([key, organization, projects]).encode()).hexdigest()[:24]
    payload = {
        'name': f'Barghsa v{version} {target}',
        'environment': scope['environment'],
        'dateStarted': datetime.fromtimestamp(cutover / 1000, timezone.utc).isoformat(timespec='milliseconds'),
        'dateFinished': datetime.fromtimestamp(finished, timezone.utc).isoformat(timespec='milliseconds'),
        'projects': projects,
        'url': f'https://github.com/{REPOSITORY}/blob/{commit}/releases/{version}.md',
    }
    path = f'/api/0/organizations/{organization}/releases/{commit}/deploys/'
    fingerprint = sha256(json.dumps([config['origin'], organization, payload], sort_keys=True).encode()).hexdigest()
    marker = publish_once(receipt.parent / ('.sentry-release-' + key), fingerprint,
                          lambda: deploy_id(request, path, payload), lambda: request(path, payload=payload),
                          'sentry_marker')
    return {'status': 'verified', 'deploy_id': marker, 'organization': organization, 'projects': projects,
            'scope': scope, 'commit': commit, 'version': version, 'release_id': key}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--receipt', type=Path)
    mode.add_argument('--verify-release', action='store_true')
    args = parser.parse_args()
    try:
        if args.verify_release:
            config = read_config(args.config)
            commit, version = checked_checkout()
            release_request(config, commit)
            result = {'status': 'release_commit_verified', 'commit': commit, 'version': version,
                      'organization': config['organization'], 'projects': sorted(config['projects'])}
        else:
            result = record_deploy(args.config, args.receipt)
        print(json.dumps(result))
        return 0
    except ReleaseEvidenceError as error:
        print(str(error), file=sys.stderr)
    except (OSError, AttributeError, TypeError, KeyError, ValueError, OverflowError, RecursionError,
            subprocess.SubprocessError):
        print('sentry_release_marker_unavailable', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
