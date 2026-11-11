import { operationsAlertLinks } from '@barghsa/shared/notifications';
import { expect, it } from 'vitest';
import { parseOperationsAlerts } from './alerts.js';

const base = {
  environment: 'staging',
  database: 'core',
  service: 'consultation',
  availability_tier: 'pilot',
};

function parse(labels: Record<string, string>, status = 'firing') {
  return parseOperationsAlerts(
    {
      alerts: [{ labels, status, fingerprint: 'a'.repeat(16), startsAt: '2020-01-01T00:00:00Z' }],
    },
    'staging',
    'core'
  );
}

it.each([
  ['JourneyErrorBudgetFastBurn', 'critical', 'P1', '1h', 'firing'],
  ['JourneyErrorBudgetSlowBurn', 'warning', 'P2', '24h', 'resolved'],
])(
  'preserves the validated service and links for %s',
  (alertname, severity, priority, window, status) => {
    expect(parse({ ...base, alertname, severity, priority, window }, status)).toMatchObject([
      { name: alertname, severity, priority, service: 'consultation', status },
    ]);
    expect(
      operationsAlertLinks('admin.operations_alert', {
        operationsAlertName: alertname,
        operationsDashboardOrigin: 'https://grafana.example.test',
      }).map(({ href }) => href)
    ).toEqual([
      'https://grafana.example.test/d/barghsa-executive-slo',
      'https://github.com/barghsadev/barghsa-core/blob/main/docs/runbooks/journey-availability.md',
    ]);
  }
);

it.each([
  { service: '' },
  { service: 'arbitrary text' },
  { service: '__proto__' },
  { availability_tier: 'unknown' },
  { window: '24h' },
  { priority: 'P2' },
  { environment: 'production' },
])('refuses mismatched or missing alert labels %j', (overrides) => {
  expect(() =>
    parse({
      ...base,
      alertname: 'JourneyErrorBudgetFastBurn',
      severity: 'critical',
      priority: 'P1',
      window: '1h',
      ...overrides,
    })
  ).toThrow('Invalid alert scope or identity');
});

it.each([
  ['SyntheticProbeFailed', { check: 'login' }, { syntheticCheck: 'login' }],
  ['SyntheticProbeUnavailable', {}, {}],
] as const)('validates the scoped P1 and dashboard link for %s', (alertname, extra, expected) => {
  expect(
    parse({ ...base, alertname, severity: 'critical', priority: 'P1', ...extra })
  ).toMatchObject([{ name: alertname, priority: 'P1', ...expected }]);
  expect(
    operationsAlertLinks('admin.operations_alert', {
      operationsAlertName: alertname,
      operationsDashboardOrigin: 'https://grafana.example.test',
    }).map(({ href }) => href)
  ).toEqual([
    'https://grafana.example.test/d/barghsa-executive-slo',
    'https://github.com/barghsadev/barghsa-core/blob/main/docs/runbooks/journey-availability.md',
  ]);
});

it.each(['', '__proto__', 'unlisted'])('rejects an unknown synthetic check %j', (check) => {
  expect(() =>
    parse({
      ...base,
      alertname: 'SyntheticProbeFailed',
      severity: 'critical',
      priority: 'P1',
      check,
    })
  ).toThrow('Invalid alert scope or identity');
});

it.each(['PostgresBackupFailed', 'PostgresBackupStale', 'PostgresBackupMonitoringUnavailable'])(
  'validates the scoped P1 and recovery links for %s',
  (alertname) => {
    const labels = { ...base, alertname, severity: 'critical', priority: 'P1' };
    expect(parse(labels)).toMatchObject([{ name: alertname, priority: 'P1' }]);
    expect(() => parse({ ...labels, database: 'other' })).toThrow(
      'Invalid alert scope or identity'
    );
    expect(() => parse({ ...labels, priority: 'P2' })).toThrow('Invalid alert scope or identity');
    expect(
      operationsAlertLinks('admin.operations_alert', {
        operationsAlertName: alertname,
        operationsDashboardOrigin: 'https://grafana.example.test',
      }).map(({ href }) => href)
    ).toEqual([
      'https://grafana.example.test/d/barghsa-postgresql',
      'https://github.com/barghsadev/barghsa-core/blob/main/docs/runbooks/postgresql-backup.md',
    ]);
  }
);
