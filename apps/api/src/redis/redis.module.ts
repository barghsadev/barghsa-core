import { Global, Logger, Module } from '@nestjs/common';
import { createRedisClient, RedisConfigSchema, type RedisConfig } from '@barghsa/shared/redis';
import { operatorLogTrace } from '@barghsa/shared/operator-logging';
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Redis } from 'ioredis';
import { apiOperationTracer } from '../metrics/domain-tracing.js';

const tracedCommands = new Set([
  'del',
  'eval',
  'get',
  'incr',
  'mget',
  'ping',
  'scan',
  'set',
  'setex',
]);

function traceRedisCommands(client: Redis): void {
  const send = client.sendCommand.bind(client);
  const observed = new WeakSet<Parameters<Redis['sendCommand']>[0]>();
  client.sendCommand = (command, stream) => {
    const tracer = apiOperationTracer.getStore();
    const parent = operatorLogTrace.getStore();
    if (!tracer || !parent || observed.has(command)) return send(command, stream);

    observed.add(command);
    const operation = tracedCommands.has(command.name) ? command.name.toUpperCase() : '_OTHER';
    const span = tracer.startSpan(
      `redis ${operation}`,
      {
        kind: SpanKind.CLIENT,
        attributes: { 'db.system.name': 'redis', 'db.operation.name': operation },
      },
      trace.setSpanContext(ROOT_CONTEXT, parent)
    );
    const fail = () => {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    };
    try {
      const result = send(command, stream);
      // Preserve ioredis's own return value, callbacks and retry behavior.
      void command.promise.then(() => span.end(), fail);
      return result;
    } catch (error) {
      fail();
      throw error;
    }
  };
}

/**
 * NestJS injection token for the Redis client instance.
 * Inject with `@Inject(REDIS_CLIENT) private readonly redis: Redis | null`.
 */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: async (): Promise<ReturnType<typeof createRedisClient>> => {
        const rawUrl = process.env['REDIS_URL'];
        const rawHost = process.env['REDIS_HOST'];

        const config: RedisConfig = {
          url: rawUrl,
          host: rawHost,
          port: process.env['REDIS_PORT'] ? Number(process.env['REDIS_PORT']) : undefined,
          password: process.env['REDIS_PASSWORD'],
          // Only an explicit plain Redis URL opts out of the production TLS default.
          tls: rawUrl?.startsWith('redis://')
            ? undefined
            : process.env['NODE_ENV'] === 'production'
              ? true
              : undefined,
        };

        // Validate — silently skip on invalid env config
        const parsed = RedisConfigSchema.safeParse(config);
        if (!parsed.success) {
          return null;
        }

        const logger = new Logger('RedisModule');
        const client = await createRedisClient(parsed.data, {
          warn: (msg, ...meta) => logger.warn(msg, ...meta),
          error: (msg, ...meta) => logger.error(msg, ...meta),
        });
        if (client) traceRedisCommands(client);
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
