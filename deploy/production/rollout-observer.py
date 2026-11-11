#!/usr/bin/env python3
"""Read candidate smoke and production monitoring for guarded-rollout.py."""

import argparse
from datetime import datetime
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


JOURNEYS = {
    'electricity': ('/api/electricity/orders', 'orders', 'orderId'),
    'saving': ('/api/saving/orders', 'orders', 'id'),
    'solar': ('/api/solar/requests', 'requests', 'id'),
    'consultation': ('/api/consultations/requests', 'requests', 'id'),
}
SECURITY_RULES = {'PaymentCallbackAnomaly', 'PaymentIdempotencyConflict'}
RELEASE = 'barghsa_api_release_info'
HTTP = 'barghsa_http_request_duration_seconds_count'
JOURNEY = 'barghsa_rollout_journey_attempts_total'
DRIFT = 'reconciliation_wallets_critical_drift'
API_START = 'node_process_start_time_seconds'
PROBE_START = 'process_start_time_seconds'
MAX_CONFIG = 65536
MAX_RESPONSE = 8 * 1024 * 1024
MAX_COUNT = 10**12
UUID = r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}'
LABEL = r'[A-Za-z0-9_.-]{1,64}'


class ObservationError(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise ObservationError(reason)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def protected_config(path):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o077,
                'unsafe_configuration_permissions')
        body = source.read(MAX_CONFIG + 1)
    require(len(body) <= MAX_CONFIG, 'configuration_too_large')
    return json.loads(body)


def origin(value):
    parsed = urlsplit(value)
    require(parsed.hostname and parsed.username is None and not parsed.path
            and not parsed.query and not parsed.fragment, 'invalid_origin')
    if parsed.scheme != 'https':
        require(parsed.scheme == 'http' and ipaddress.ip_address(parsed.hostname).is_loopback,
                'origin_requires_https')
    return value


class JsonReader:
    def __init__(self, base, headers=None):
        self.base = origin(base)
        self.headers = headers or {}
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def get(self, path, params=None, *, authenticated=False):
        if params is not None:
            path += '?' + urlencode(params)
        headers = {'Accept': 'application/json', 'Cache-Control': 'no-cache'}
        if authenticated:
            headers.update(self.headers)
        with self.opener.open(Request(self.base + path, headers=headers), timeout=5) as response:
            require(response.status == 200 and response.headers.get_content_type() == 'application/json',
                    'invalid_http_response')
            body = response.read(MAX_RESPONSE + 1)
        require(len(body) <= MAX_RESPONSE, 'http_response_too_large')
        return json.loads(body)


def release_ready(reader, commit):
    if (reader.get('/release.json').get('commit') != commit
            or reader.get('/api/health/live').get('status') != 'ok'):
        return False
    ready = reader.get('/api/health/ready')
    return ready.get('status') == 'ok' and ready.get('checks', {}).get('postgresql', {}).get('status') == 'ok'


def smoke(reader, previous, config):
    results = dict.fromkeys(('health', *JOURNEYS), False)
    results['health'] = (release_ready(reader, config['candidate']['revision']['commit'])
                         and release_ready(previous, config['previous']['revision']['commit']))
    if not results['health']:
        return results
    user = reader.get('/api/auth/user', authenticated=True)
    if (user.get('userId') != config['user_id'] or user.get('isStaff') is not False
            or user.get('operatingContext') != 'customer'
            or user.get('navigation', {}).get('profileId') != config['profile_id']):
        return results
    for name, (path, collection, key) in JOURNEYS.items():
        rows = reader.get(path, {'profileId': config['profile_id']}, authenticated=True).get(collection)
        results[name] = isinstance(rows, list) and any(
            isinstance(row, dict) and row.get(key) == config['fixtures'][name] for row in rows
        )
    return results


def parse_series(result, scope, jobs):
    series = {}
    for row in result:
        labels = row['metric']
        job, instance = labels['job'], labels['instance']
        require(job in jobs and instance in jobs[job] and all(labels.get(k) == v for k, v in scope.items()),
                'foreign_monitoring_series')
        name = labels['__name__']
        key = tuple(sorted(labels.items()))
        target = series.setdefault((job, instance), {}).setdefault(name, {})
        require(key not in target, 'duplicate_monitoring_series')
        values = {}
        for timestamp, raw in row['values']:
            number = float(raw)
            require(math.isfinite(timestamp) and math.isfinite(number) and number >= 0 and timestamp not in values,
                    'invalid_monitoring_sample')
            values[timestamp] = number
        require(values, 'empty_monitoring_series')
        target[key] = values
    require(set(series) == {(job, instance) for job, instances in jobs.items() for instance in instances},
            'monitoring_targets_missing')
    return series


def only_series(metrics, name):
    series = metrics.get(name, {})
    require(len(series) == 1, 'missing_or_ambiguous_' + name)
    key, values = next(iter(series.items()))
    return dict(key), values


def coverage(metrics, since, now, freshness):
    _, up = only_series(metrics, 'up')
    before = [stamp for stamp in up if stamp <= since]
    require(before and since - freshness <= max(before), 'monitoring_baseline_sample_missing')
    first = max(before)
    times = sorted(stamp for stamp in up if stamp >= first)
    require(now - freshness <= times[-1] <= now
            and all(up[stamp] == 1 for stamp in times)
            and all(b - a <= freshness for a, b in zip(times, times[1:])),
            'incomplete_monitoring_coverage')
    return times


def stable(metrics, name, times):
    labels, values = only_series(metrics, name)
    require(set(times) == values.keys() and len(set(values.values())) == 1, 'unstable_' + name)
    return labels, values[times[-1]]


def counter(values, times, since, until, *, initialized):
    points = sorted(values)
    expected = times if initialized else [stamp for stamp in times if stamp >= points[0]]
    require(points == expected and all(n.is_integer() and n <= MAX_COUNT for n in values.values())
            and all(values[b] >= values[a] for a, b in zip(points, points[1:])),
            'counter_gap_or_reset')
    window = [stamp for stamp in times if since <= stamp <= until]
    if len(window) < 2 or window[-1] < points[0]:
        return 0
    return int(values[window[-1]] - values.get(window[0], 0))


def traffic(targets, selected, since, until):
    api = {'attempts': 0, 'failures': 0}
    journeys = {name: {'attempts': 0, 'failures': 0} for name in JOURNEYS}
    for (job, _), (metrics, times) in targets.items():
        if job == selected['api_job']:
            for key, values in metrics.get(HTTP, {}).items():
                status = dict(key).get('status', '')
                require(re.fullmatch(r'[1-5][0-9]{2}', status), 'invalid_http_status_label')
                count = counter(values, times, since, until, initialized=False)
                api['attempts'] += count
                if status.startswith('5'):
                    api['failures'] += count
        if job == selected['journey_job']:
            stable(metrics, PROBE_START, times)
            expected = {(service, outcome) for service in JOURNEYS for outcome in ('success', 'failure')}
            for key, values in metrics.get(JOURNEY, {}).items():
                labels = dict(key)
                service, outcome = labels.get('service'), labels.get('outcome')
                require((service, outcome) in expected and labels.get('revision') == selected['revision']['commit'],
                        'foreign_or_duplicate_journey_counter')
                expected.remove((service, outcome))
                count = counter(values, times, since, until, initialized=True)
                journeys[service]['attempts'] += count
                if outcome == 'failure':
                    journeys[service]['failures'] += count
            require(not expected, 'journey_counters_missing')
    return api, journeys


def monitoring(reader, config, selected, since, *, baseline=False, measure=True):
    scope = config['scope']
    jobs = {selected['api_job']}
    if measure:
        jobs.add(selected['journey_job'])
    if not baseline:
        jobs.update((config['previous']['api_job'], config['wallet_job']))
    now = time.time()
    freshness = config['max_scrape_age_seconds']
    require(0 <= now - since <= 7200, 'invalid_observation_window')
    selected_jobs = {job: config['targets'][job] for job in jobs}
    names = ('up', RELEASE, HTTP, JOURNEY, DRIFT, API_START, PROBE_START)
    selectors = [f'{key}={json.dumps(value)}' for key, value in scope.items()]
    selectors += ['job=~' + json.dumps('|'.join(job.replace('.', r'\.') for job in sorted(jobs))),
                  '__name__=~' + json.dumps('|'.join(names))]
    duration = math.ceil(now - since) + freshness + 1
    query = '{' + ','.join(selectors) + '}[' + str(duration) + 's]'
    result = reader.get('/api/v1/query', {'query': query, 'time': now}, authenticated=True)
    require(result.get('status') == 'success' and not result.get('warnings')
            and result['data']['resultType'] == 'matrix', 'monitoring_query_failed')
    series = parse_series(result['data']['result'], scope, selected_jobs)
    targets = {}
    drift = 0
    api_pools = {pool['api_job']: pool for pool in (selected, config['previous'])}
    for target, metrics in series.items():
        job, _ = target
        # Identity and continuity must hold from the last scrape before the window.
        times = coverage(metrics, since, now, freshness)
        first = times[0]
        metrics = {
            name: {key: inside for key, values in rows.items()
                   if (inside := {stamp: value for stamp, value in values.items() if stamp >= first})}
            for name, rows in metrics.items()
        }
        targets[target] = (metrics, times)
        if job in api_pools:
            labels, value = stable(metrics, RELEASE, times)
            require(labels.get('revision') == api_pools[job]['revision']['commit'] and value == 1,
                    'monitoring_release_mismatch')
            stable(metrics, API_START, times)
        if not baseline and job == config['wallet_job']:
            _, values = only_series(metrics, DRIFT)
            require(values.keys() == set(times) and all(n.is_integer() and n <= MAX_COUNT for n in values.values()),
                    'wallet_drift_unavailable')
            drift = max(drift, int(max(values.values())))
    observed_at = max(since, min(times[-1] for _, times in targets.values()))
    if measure:
        api, journeys = traffic(targets, selected, since, observed_at)
    else:
        api, journeys = None, None
    return observed_at, api, journeys, drift


def security_alerts(reader, config):
    data = reader.get('/api/v1/rules', {'type': 'alert'}, authenticated=True)
    require(data.get('status') == 'success' and not data.get('warnings'), 'security_rules_unavailable')
    required = SECURITY_RULES | set(config.get('additional_security_rules', []))
    found = set()
    alerts = 0
    now = time.time()
    for group in data['data']['groups']:
        for rule in group['rules']:
            name = rule['name']
            if name not in required:
                continue
            stamp = re.fullmatch(r'([0-9T:-]{19})(?:\.([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})',
                                 rule['lastEvaluation'])
            require(stamp, 'invalid_security_rule_timestamp')
            # Prometheus uses RFC3339Nano. Python 3.9 accepts only fixed fractional lengths.
            evaluated = datetime.fromisoformat(stamp[1] + stamp[3].replace('Z', '+00:00')).timestamp()
            evaluated += float('0.' + (stamp[2] or '0'))
            require(name not in found and rule['type'] == 'alerting' and rule['health'] == 'ok'
                    and 0 <= now - evaluated <= config['max_scrape_age_seconds'],
                    'security_rule_unhealthy')
            found.add(name)
            for alert in rule['alerts']:
                labels = alert['labels']
                require(set(config['scope']) <= labels.keys() and alert['state'] in ('pending', 'firing'),
                        'security_alert_unscoped')
                if all(labels[key] == value for key, value in config['scope'].items()):
                    alerts += 1
    require(found == required, 'security_rules_missing')
    return alerts


def validate_config(config):
    scope = config['scope']
    require(set(scope) == {'environment', 'database'} and all(re.fullmatch(LABEL, v) for v in scope.values()),
            'invalid_scope')
    require(type(config['max_scrape_age_seconds']) is int and 5 <= config['max_scrape_age_seconds'] <= 120,
            'invalid_monitoring_freshness')
    jobs = {config['wallet_job']}
    for key in ('previous', 'candidate'):
        selected = config[key]
        revision = selected['revision']
        require(set(revision) == {'commit', 'app_image', 'web_image'}
                and re.fullmatch(r'[a-f0-9]{40}', revision['commit'])
                and all(re.fullmatch(r'sha256:[a-f0-9]{64}', revision[name]) for name in ('app_image', 'web_image')),
                'invalid_release_identity')
        jobs.update((selected['api_job'], selected['journey_job']))
    require(len(jobs) == 5 and jobs == set(config['targets'])
            and all(re.fullmatch(LABEL, job) and isinstance(instances, list) and instances
                    and len(set(instances)) == len(instances)
                    and all(isinstance(instance, str) and instance for instance in instances)
                    for job, instances in config['targets'].items()), 'invalid_monitoring_targets')
    require(len({config['previous']['origin'], config['candidate']['origin'], config['prometheus_origin']}) == 3
            and config['previous']['revision']['commit'] != config['candidate']['revision']['commit'],
            'rollout_pools_must_be_distinct')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--baseline-seconds', type=int)
    options = parser.parse_args()
    try:
        config = protected_config(options.config)
        validate_config(config)
        token = config['prometheus_token']
        require(re.fullmatch(r'[!-~]{1,4096}', token), 'invalid_monitoring_credential')
        prometheus = JsonReader(config['prometheus_origin'], {'Authorization': 'Bearer ' + token})
        previous = JsonReader(config['previous']['origin'])
        if options.baseline_seconds is not None:
            require(1 <= options.baseline_seconds <= 7199, 'invalid_baseline_window')
            revision = config['previous']['revision']
            require(release_ready(previous, revision['commit']), 'previous_release_unready')
            since = time.time() - options.baseline_seconds
            end, api, journeys, _ = monitoring(prometheus, config, config['previous'], since, baseline=True)
            result = {'scope': config['scope'], 'revision': revision, 'window_start': since,
                      'observed_at': end, 'journeys': journeys, **api}
        else:
            body = sys.stdin.buffer.read(MAX_CONFIG + 1)
            require(len(body) <= MAX_CONFIG, 'request_too_large')
            request = json.loads(body)
            scope = config['scope']
            candidate_revision = config['candidate']['revision']
            previous_revision = config['previous']['revision']
            weight, since = request['candidate_weight'], request['window_start']
            require(request['scope'] == scope and request['candidate'] == candidate_revision
                    and request['previous'] == previous_revision and type(weight) is int and 0 <= weight <= 100
                    and type(since) in (int, float) and math.isfinite(since), 'observation_request_mismatch')
            require(set(config['fixtures']) == set(JOURNEYS)
                    and all(re.fullmatch(UUID, value) for value in
                            (config['user_id'], config['profile_id'], *config['fixtures'].values())),
                    'invalid_synthetic_identity')
            session = config['session_id']
            require(re.fullmatch(r'[A-Za-z0-9._~-]{1,4096}', session), 'invalid_session_credential')
            candidate = JsonReader(config['candidate']['origin'], {'Cookie': 'barghsa_session=' + session})
            signals = smoke(candidate, previous, config)
            end, api, journeys, drift = monitoring(prometheus, config, config['candidate'], since, measure=weight > 0)
            result = {'scope': scope, 'candidate': candidate_revision, 'previous': previous_revision,
                      'candidate_weight': weight, 'window_start': since, 'observed_at': end, 'smoke': signals,
                      'api': api, 'journeys': journeys, 'critical_wallet_drift': drift,
                      'security_alerts': security_alerts(prometheus, config)}
        print(json.dumps(result, allow_nan=False))
        return 0
    except ObservationError as error:
        print(str(error), file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError, RecursionError):
        print('observation_unavailable', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
