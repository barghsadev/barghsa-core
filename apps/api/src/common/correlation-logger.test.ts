import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createOperatorLogger, isCorrelationId } from '@barghsa/shared/operator-logging';
import { CorrelationLogger } from './correlation-logger.js';
import { correlationIdStorage } from './correlation-id.middleware.js';

beforeEach(() => vi.stubEnv('BARGHSA_DEPLOYMENT_ENV', 'development'));
afterEach(() => vi.unstubAllEnvs());

function fixture() {
  const records: Array<Record<string, unknown>> = [];
  const write = createOperatorLogger('api', { write: (line) => records.push(JSON.parse(line)) });
  return { logger: new CorrelationLogger(write), records };
}

it.each([
  ['log', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
  ['debug', 'debug'],
  ['verbose', 'debug'],
  ['fatal', 'fatal'],
] as const)('writes %s as correlated JSON and preserves context', (method, level) => {
  const { logger, records } = fixture();
  const id = '01900000-0000-7000-8000-000000000001';
  correlationIdStorage.run(id, () => logger[method]('service outcome', 'Service'));
  logger[method]('startup', 'Service');
  const envelope = {
    level,
    timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    service: 'api',
    environment: 'development',
    context: 'Service',
  };
  expect(records).toEqual([
    { ...envelope, message: 'service outcome', correlationId: id },
    { ...envelope, message: 'startup', correlationId: expect.any(String) },
  ]);
  expect(isCorrelationId(records[1]?.correlationId)).toBe(true);
  expect(records[1]?.correlationId).not.toBe(id);
});

it('keeps concurrent asynchronous requests isolated', async () => {
  const { logger, records } = fixture();
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await Promise.all([
    correlationIdStorage.run('01900000-0000-7000-8000-000000000001', async () => {
      await gate;
      logger.log('first');
    }),
    correlationIdStorage.run('01900000-0000-7000-8000-000000000002', async () => {
      logger.log('second');
      release();
    }),
  ]);
  expect(records.map(({ message, correlationId }) => ({ message, correlationId }))).toEqual([
    { message: 'second', correlationId: '01900000-0000-7000-8000-000000000002' },
    { message: 'first', correlationId: '01900000-0000-7000-8000-000000000001' },
  ]);
});

it('omits raw error objects and fields outside the allowed diagnostic record', () => {
  const { logger, records } = fixture();
  logger.error(new Error('private database URL'), 'private stack', 'Service');
  logger.warn({ msg: 'CSP violation', 'blocked-uri': 'inline', secret: 'private token' }, 'Csp');
  expect(records).toMatchObject([
    { message: 'Unstructured API diagnostic', level: 'error', context: 'Service' },
    { message: 'CSP violation', 'blocked-uri': 'inline', level: 'warn', context: 'Csp' },
  ]);
  expect(JSON.stringify(records)).not.toMatch(/private database URL|private stack|private token/);
});
