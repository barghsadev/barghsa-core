import { Global, Module } from '@nestjs/common';
import { createRedisClient, RedisConfigSchema, type RedisConfig } from '@barghsa/shared/redis';

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
      useFactory: (): ReturnType<typeof createRedisClient> => {
        const rawUrl = process.env['REDIS_URL'];
        const rawHost = process.env['REDIS_HOST'];

        const config: RedisConfig = {
          url: rawUrl,
          host: rawHost,
          port: process.env['REDIS_PORT']
            ? Number(process.env['REDIS_PORT'])
            : undefined,
          password: process.env['REDIS_PASSWORD'],
          tls: process.env['NODE_ENV'] === 'production' ? true : undefined,
        };

        // Validate — silently skip on invalid env config
        const parsed = RedisConfigSchema.safeParse(config);
        if (!parsed.success) {
          return null;
        }

        return createRedisClient(parsed.data, console);
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}