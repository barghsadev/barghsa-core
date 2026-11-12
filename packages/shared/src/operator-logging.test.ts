import { afterEach, expect, it, vi } from 'vitest';
import { createOperatorLogger, isCorrelationId } from './operator-logging.js';

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
