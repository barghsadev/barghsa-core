#!/usr/bin/env python3
"""Read candidate smoke and production monitoring for guarded-rollout.py."""

import argparse
from datetime import datetime
from http.cookiejar import Cookie, CookieJar
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, ProxyHandler, Request, build_opener


JOURNEYS = {
    'electricity': ('/api/electricity/orders', None, 'orderId', 'profileId'),
    'saving': ('/api/saving/orders', None, 'id', 'profile_id'),
    'solar': ('/api/solar/requests', 'request', 'id', 'profile_id'),
    'consultation': ('/api/consultations/requests', 'request', 'id', 'profile_id'),
}
SECURITY_RULES = {'PaymentCallbackAnomaly', 'PaymentIdempotencyConflict', 'AuthenticationFailuresElevated'}
RELEASE = 'barghsa_api_release_info'
HTTP = 'barghsa_http_request_duration_seconds_count'
HTTP_BUCKET = 'barghsa_http_request_duration_seconds_bucket'
# Match the API histogram so incomplete or incompatible scrapes cannot pass.
HTTP_LIMITS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, math.inf)
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


def certificate_expiry(base):
    target = urlsplit(base)
    if target.scheme != 'https':
        return None
    try:
        context = ssl.create_default_context()
        port = 443 if target.port is None else target.port
        with socket.create_connection((target.hostname, port), timeout=5) as connection:
            with context.wrap_socket(connection, server_hostname=target.hostname) as peer:
                return int(ssl.cert_time_to_seconds(peer.getpeercert()['notAfter']))
    except (OSError, KeyError, ValueError):
        return None


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


def customer_matches(user, config):
    return (user.get('userId') == config['user_id'] and user.get('isStaff') is False
            and user.get('operatingContext') == 'customer'
            and user.get('navigation', {}).get('profileId') == config['profile_id'])


def fixture_profile_matches(account, profile_id):
    profiles = account.get('profiles')
    # The profile list marks only an owned default profile as isDefault.
    return (account.get('activeProfileId') == profile_id
            and isinstance(profiles, list) and len(profiles) == 1
            and isinstance(profiles[0], dict) and profiles[0].get('id') == profile_id
            and profiles[0].get('isDefault') is True)


def read_fixture(get, name, config):
    path, envelope, record_key, profile_key = JOURNEYS[name]
    fixture_id = config['fixtures'][name]
    record = get(f'{path}/{fixture_id}')
    if envelope is not None and isinstance(record, dict):
        record = record.get(envelope)
    return (isinstance(record, dict) and record.get(record_key) == fixture_id
            and record.get(profile_key) == config['profile_id'])


def smoke(reader, previous, config):
    results = dict.fromkeys(('health', 'dashboard', 'wallet', *JOURNEYS), False)
    results['health'] = (release_ready(reader, config['candidate']['revision']['commit'])
                         and release_ready(previous, config['previous']['revision']['commit']))
    if not results['health']:
        return results
    def get(path):
        return reader.get(path, authenticated=True)

    if (not customer_matches(get('/api/auth/user'), config)
            or not fixture_profile_matches(get('/api/profiles'), config['profile_id'])):
        return results
    dashboard = get('/api/dashboard/context')
    results['dashboard'] = (dashboard.get('profile', {}).get('id') == config['profile_id']
                            and dashboard.get('access', {}).get('wallet') is True)
    if results['dashboard']:
        wallet = get('/api/wallet/' + config['profile_id'])
        balance = wallet.get('balance')
        results['wallet'] = (wallet.get('currency') == 'IRR' and isinstance(balance, str)
                             and bool(re.fullmatch(r'0|[1-9][0-9]{0,18}', balance)))
    for name in JOURNEYS:
        try:
            results[name] = read_fixture(get, name, config)
        except HTTPError as error:
            if error.code != 404:
                raise
    return results


SYNTHETIC_CHECKS = ('liveness', 'readiness', 'login', 'account', *JOURNEYS, 'logout')


class SyntheticBrowser:
    """A dedicated cookie jar for the ordinary customer authentication flow."""

    def __init__(self, base, device):
        self.base = origin(base)
        self.cookies = CookieJar()
        if device:
            secure = self.base.startswith('https://')
            self.cookies.set_cookie(Cookie(
                0, '__Host-barghsa_device' if secure else 'barghsa_device', device, None, False,
                urlsplit(self.base).hostname, False, False, '/', True, secure, None, True,
                None, None, {}, False,
            ))
        self.opener = build_opener(ProxyHandler({}), NoRedirect(), HTTPCookieProcessor(self.cookies))
        self.correlation_id = None
        self.session_csrf = None

    def capture_reference(self, headers):
        reference = headers.get('X-Correlation-Id', '')
        self.correlation_id = reference if re.fullmatch(UUID, reference) else None

    def request(self, path, data=None, csrf=None):
        headers = {
            'Accept': 'application/json', 'Cache-Control': 'no-cache',
            'User-Agent': 'BarghsaSynthetic/1.0',
        }
        body = None
        if data is not None:
            headers.update({
                'Content-Type': 'application/json', 'Origin': self.base, 'X-CSRF-Token': csrf,
            })
            body = json.dumps(data).encode()
        try:
            with self.opener.open(Request(self.base + path, data=body, headers=headers), timeout=5) as response:
                self.capture_reference(response.headers)
                require(response.status == 200 and response.headers.get_content_type() == 'application/json',
                        'invalid_http_response')
                payload = response.read(262145)
        except HTTPError as error:
            self.capture_reference(error.headers)
            error.close()
            raise
        require(len(payload) <= 262144, 'http_response_too_large')
        value = json.loads(payload)
        require(isinstance(value, dict), 'invalid_http_response')
        return value

    def csrf_token(self):
        csrf = self.request('/api/auth/csrf').get('csrfToken')
        require(isinstance(csrf, str) and re.fullmatch(r'[a-f0-9]{64}', csrf), 'invalid_csrf_acknowledgement')
        return csrf

    def preauth(self, path, data):
        return self.request(path, data, self.csrf_token())

    def has_session(self):
        return any(cookie.name == 'barghsa_session' and not cookie.is_expired() for cookie in self.cookies)

    def login(self, config):
        started = int(time.time())
        response = self.preauth('/api/auth/login', {
            'username': config['username'], 'password': config['password'],
        })
        if response.get('requiresOtp') is True:
            require(response.get('userIsStaff') is not True, 'unexpected_staff_challenge')
            challenge = response.get('challengeId')
            require(isinstance(challenge, str) and re.fullmatch(UUID, challenge), 'invalid_login_challenge')
            otp = synthetic_otp(config.get('otp_reader'), challenge, started)
            response = self.preauth('/api/auth/login/verify', {
                'challengeId': challenge, 'otp': otp, 'trustDevice': False,
            })
        else:
            require(response.get('requiresOtp') is False, 'invalid_login_acknowledgement')
        csrf = response.get('csrfToken')
        if isinstance(csrf, str) and re.fullmatch(r'[a-f0-9]{64}', csrf):
            self.session_csrf = csrf
        require(self.session_csrf and response.get('userId') == config['user_id'] and self.has_session(),
                'unexpected_session_identity')

    def logout(self):
        self.request('/api/auth/logout', {}, self.session_csrf or self.csrf_token())
        require(not any(cookie.name in ('barghsa_session', 'barghsa_refresh') and not cookie.is_expired()
                        for cookie in self.cookies), 'session_cookies_not_cleared')


def synthetic_otp(reader, challenge, started):
    require(reader is not None, 'fixture_otp_reader_required')
    value = subprocess.run(
        [reader], input=json.dumps({'challengeId': challenge, 'requested_at': started}),
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, text=True, timeout=25,
    ).stdout.strip()
    require(bool(re.fullmatch(r'[0-9]{6}', value)), 'invalid_fixture_otp')
    return value


def validate_synthetic(config):
    require(isinstance(config, dict) and set(config) <= {
        'origin', 'user_id', 'profile_id', 'fixtures', 'username', 'password', 'device_token', 'otp_reader',
    }, 'invalid_synthetic_config')
    origin(config['origin'])
    require(set(config['fixtures']) == set(JOURNEYS)
            and all(re.fullmatch(UUID, value) for value in
                    (config['user_id'], config['profile_id'], *config['fixtures'].values())),
            'invalid_synthetic_identity')
    require(isinstance(config['username'], str) and 1 <= len(config['username']) <= 255
            and isinstance(config['password'], str) and 1 <= len(config['password']) <= 1024,
            'invalid_synthetic_credentials')
    device = config.get('device_token')
    require(device is None or re.fullmatch(r'[a-f0-9]{64}', device), 'invalid_synthetic_device')
    reader = config.get('otp_reader')
    require(device or reader, 'synthetic_authentication_method_required')
    if reader is not None:
        path = Path(reader)
        require(path.is_absolute(), 'invalid_otp_reader')
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid in (0, os.geteuid())
                and not info.st_mode & 0o022 and os.access(path, os.X_OK), 'unsafe_otp_reader')


def verify_synthetic_account(browser, config):
    require(customer_matches(browser.request('/api/auth/user'), config), 'unexpected_account_identity')
    require(fixture_profile_matches(browser.request('/api/profiles'), config['profile_id']),
            'fixture_profile_not_isolated')


def synthetic(config):
    validate_synthetic(config)
    public = SyntheticBrowser(config['origin'], None)
    browser = SyntheticBrowser(config['origin'], config.get('device_token'))
    results = {name: {'status': 'skipped'} for name in SYNTHETIC_CHECKS}

    def check(name, client, operation):
        started = time.monotonic()
        client.correlation_id = None
        outcome = {'status': 'passed'}
        try:
            operation()
        except ObservationError as error:
            outcome = {'status': 'failed', 'reason': str(error)}
        except HTTPError as error:
            outcome = {'status': 'failed', 'reason': 'http_failure', 'http_status': error.code}
        except subprocess.SubprocessError:
            outcome = {'status': 'failed', 'reason': 'fixture_otp_reader_failed'}
        except (OSError, ValueError, KeyError, TypeError, AttributeError, RecursionError):
            outcome = {'status': 'failed', 'reason': 'probe_unavailable'}
        results[name] = {
            **outcome, 'duration_ms': round((time.monotonic() - started) * 1000),
            'correlation_id': client.correlation_id,
        }
        return outcome['status'] == 'passed'

    live = check('liveness', public, lambda: require(
        public.request('/api/health/live').get('status') == 'ok', 'liveness_failed',
    ))
    ready = check('readiness', public, lambda: require(
        public.request('/api/health/ready').get('status') == 'ok', 'readiness_failed',
    ))
    if live and ready:
        try:
            login = check('login', browser, lambda: browser.login(config))
            if login and check('account', browser, lambda: verify_synthetic_account(browser, config)):
                for name in JOURNEYS:
                    check(name, browser, lambda: require(
                        read_fixture(browser.request, name, config), 'fixture_unavailable',
                    ))
        finally:
            if browser.has_session():
                check('logout', browser, browser.logout)
    expiry = certificate_expiry(config['origin'])
    report = {'observed_at': int(time.time()), 'checks': results}
    if expiry is not None:
        report['tls_certificate_expiry_timestamp_seconds'] = expiry
    return report


def synthetic_metrics(path, report):
    lines = [
        '# HELP barghsa_synthetic_probe_completed_timestamp_seconds Unix time of the last complete synthetic run.',
        '# TYPE barghsa_synthetic_probe_completed_timestamp_seconds gauge',
        f"barghsa_synthetic_probe_completed_timestamp_seconds {report['observed_at']}",
        '# HELP barghsa_synthetic_probe_success Result of each executed check in the last synthetic run.',
        '# TYPE barghsa_synthetic_probe_success gauge',
    ]
    for name, result in report['checks'].items():
        if result['status'] != 'skipped':
            lines.append(f'barghsa_synthetic_probe_success{{check="{name}"}} {int(result["status"] == "passed")}')
    expiry = report.get('tls_certificate_expiry_timestamp_seconds')
    if expiry is not None:
        lines.extend([
            '# HELP barghsa_synthetic_probe_tls_certificate_expiry_timestamp_seconds Expiry of the verified public HTTPS leaf certificate.',
            '# TYPE barghsa_synthetic_probe_tls_certificate_expiry_timestamp_seconds gauge',
            f'barghsa_synthetic_probe_tls_certificate_expiry_timestamp_seconds {expiry}',
        ])
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix='.synthetic-', delete=False) as out:
        staged = Path(out.name)
        try:
            out.write('\n'.join(lines) + '\n')
            out.close()
            staged.chmod(0o644)
            staged.replace(path)
        finally:
            staged.unlink(missing_ok=True)


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


def http_traffic(metrics, times, since, until):
    histograms = {}
    for key, values in metrics.get(HTTP_BUCKET, {}).items():
        labels = dict(key)
        limit = float(labels.pop('le'))
        labels['__name__'] = HTTP
        histogram = histograms.setdefault(tuple(sorted(labels.items())), {})
        require(limit in HTTP_LIMITS and limit not in histogram, 'invalid_http_latency_bucket')
        histogram[limit] = values

    counts = metrics.get(HTTP, {})
    require(counts.keys() == histograms.keys(), 'http_latency_series_mismatch')
    attempts = failures = 0
    totals = [0] * len(HTTP_LIMITS)
    for key, values in counts.items():
        status = dict(key).get('status', '')
        require(re.fullmatch(r'[1-5][0-9]{2}', status), 'invalid_http_status_label')
        count = counter(values, times, since, until, initialized=False)
        attempts += count
        if status.startswith('5'):
            failures += count
        histogram = histograms[key]
        require(histogram.keys() == set(HTTP_LIMITS) and histogram[math.inf] == values
                and all(samples.keys() == values.keys() for samples in histogram.values()),
                'incomplete_http_latency_histogram')
        deltas = [counter(histogram[limit], times, since, until, initialized=False)
                  for limit in HTTP_LIMITS]
        require(all(a <= b for a, b in zip(deltas, deltas[1:])), 'nonmonotonic_http_latency_histogram')
        totals = [total + delta for total, delta in zip(totals, deltas)]
    return attempts, failures, totals


def latency_upper_bound(histogram, attempts, percentile):
    # A finite upper bucket bounds the percentile without assuming a within-bucket distribution.
    rank = (percentile * attempts + 99) // 100
    return next((limit for limit, count in zip(HTTP_LIMITS[:-1], histogram) if rank and count >= rank), None)


def traffic(targets, selected, since, until):
    api = {'attempts': 0, 'failures': 0}
    histogram = [0] * len(HTTP_LIMITS)
    journeys = {name: {'attempts': 0, 'failures': 0} for name in JOURNEYS}
    for (job, _), (metrics, times) in targets.items():
        if job == selected['api_job']:
            attempts, failures, buckets = http_traffic(metrics, times, since, until)
            api['attempts'] += attempts
            api['failures'] += failures
            histogram = [total + count for total, count in zip(histogram, buckets)]
        if job == selected['journey_job']:
            stable(metrics, API_START if job == selected['api_job'] else PROBE_START, times)
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
    api['p95_upper_seconds'] = latency_upper_bound(histogram, api['attempts'], 95)
    api['p99_upper_seconds'] = (
        latency_upper_bound(histogram, api['attempts'], 99) if api['attempts'] >= 1000 else None
    )
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
    if measure:
        names += (HTTP_BUCKET,)
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
            require(labels.get('barghsa_role') == 'api', 'authentication_scrape_role_missing')
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
        pool_jobs = {selected['api_job'], selected['journey_job']}
        require(not jobs.intersection(pool_jobs), 'invalid_monitoring_targets')
        jobs.update(pool_jobs)
    require(jobs == set(config['targets'])
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
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--baseline-seconds', type=int)
    mode.add_argument('--synthetic', action='store_true')
    parser.add_argument('--metrics-file', type=Path)
    options = parser.parse_args()
    if options.metrics_file and not options.synthetic:
        parser.error('--metrics-file requires --synthetic')
    try:
        config = protected_config(options.config)
        if options.synthetic:
            result = synthetic(config)
            if options.metrics_file:
                synthetic_metrics(options.metrics_file, result)
            print(json.dumps(result, allow_nan=False))
            return int(any(check['status'] != 'passed' for check in result['checks'].values()))
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
