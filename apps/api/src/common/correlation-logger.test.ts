import { afterEach, expect, it, vi } from 'vitest';
import { ConsoleLogger } from '@nestjs/common';
import { CorrelationLogger } from './correlation-logger.js';
import { correlationIdStorage } from './correlation-id.middleware.js';

afterEach(() => vi.restoreAllMocks());
it.each(['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const)(
  'attaches request correlation to %s while preserving context',
  (level) => {
    const output = vi.spyOn(ConsoleLogger.prototype, level).mockImplementation(() => {});
    const logger = new CorrelationLogger();
    const id = '01900000-0000-7000-8000-000000000001';
    correlationIdStorage.run(id, () => logger[level]('service outcome', 'Service'));
    expect(output).toHaveBeenCalledWith(
      { message: 'service outcome', correlationId: id },
      'Service'
    );
    logger[level]('startup', 'Service');
    expect(output).toHaveBeenLastCalledWith('startup', 'Service');
  }
);
it('keeps concurrent asynchronous requests isolated', async () => {
  const output = vi.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => {});
  const logger = new CorrelationLogger();
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
  expect(output.mock.calls).toEqual([
    [{ message: 'second', correlationId: '01900000-0000-7000-8000-000000000002' }],
    [{ message: 'first', correlationId: '01900000-0000-7000-8000-000000000001' }],
  ]);
});
