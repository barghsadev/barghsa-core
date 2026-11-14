import { afterEach, expect, it, vi } from 'vitest';
import {
  createOperatorLogger,
  currentTraceparent,
  isCorrelationId,
  operatorLogCorrelation,
  operatorLogTrace,
} from './operator-logging.js';

afterEach(() => vi.unstubAllEnvs());

it.each([
  ['development', ['debug', 'info', 'warn', 'error', 'fatal']],
  ['staging', ['info', 'warn', 'error', 'fatal']],
  ['production', ['warn', 'error', 'fatal']],
] as const)(
  'uses the %s deployment level even with production Node settings',
  (environment, levels) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BARGHSA_DEPLOYMENT_ENV', environment);
    const records: Array<Record<string, unknown>> = [];
    const write = createOperatorLogger('worker', {
      write: (line) => records.push(JSON.parse(line)),
    });
    for (const level of ['debug', 'info', 'warn', 'error', 'fatal'] as const) {
      write(level, 'Scheduled scan outcome', { correlationId: 'invalid-id' });
    }
    expect(records.map((record) => record.level)).toEqual(levels);
    for (const record of records) {
      expect(record).toMatchObject({
        environment,
        service: 'worker',
        message: 'Scheduled scan outcome',
      });
      expect(isCorrelationId(record.correlationId)).toBe(true);
    }
    expect(new Set(records.map((record) => record.correlationId)).size).toBe(records.length);
  }
);

it('propagates a valid sampled or unsampled trace and ignores malformed or zero IDs', () => {
  const traceId = 'ab'.repeat(16);
  const spanId = 'cd'.repeat(8);
  expect(currentTraceparent()).toBeNull();
  for (const traceFlags of [0, 1]) {
    expect(operatorLogTrace.run({ traceId, spanId, traceFlags }, currentTraceparent)).toBe(
      `00-${traceId}-${spanId}-0${traceFlags}`
    );
  }
  for (const ids of [
    { traceId: 'invalid', spanId },
    { traceId, spanId: 'invalid' },
    { traceId: '0'.repeat(32), spanId },
    { traceId, spanId: '0'.repeat(16) },
  ]) {
    expect(operatorLogTrace.run({ ...ids, traceFlags: 1 }, currentTraceparent)).toBeNull();
  }
});

it('logs the active trace and falls back to the request correlation ID', () => {
  vi.stubEnv('BARGHSA_DEPLOYMENT_ENV', 'staging');
  const traceId = 'ab'.repeat(16);
  const spanId = 'cd'.repeat(8);
  const correlationId = '11111111-1111-7111-8111-111111111111';
  const explicit = '22222222-2222-7222-8222-222222222222';
  const records: unknown[] = [];
  const log = createOperatorLogger('worker', { write: (line) => records.push(JSON.parse(line)) });
  operatorLogCorrelation.run(correlationId, () => {
    operatorLogTrace.run({ traceId, spanId, traceFlags: 1 }, () => {
      log('warn', 'Private job stopped', { correlationId: 'invalid' });
      log('warn', 'Private job stopped', { correlationId: explicit });
    });
  });
  expect(records).toMatchObject([
    { correlationId, traceId, spanId },
    { correlationId: explicit, traceId, spanId },
  ]);
});
