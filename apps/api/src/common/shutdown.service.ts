import { Injectable, OnApplicationShutdown, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { getDbPool } from '@barghsa/db';

/**
 * Graceful shutdown handler for the NestJS API server.
 *
 * On SIGTERM (or SIGINT) the service:
 * 1. Stops accepting new HTTP requests by closing the HTTP server.
 * 2. Waits for in-flight requests to complete.
 * 3. Closes the database connection pool.
 * 4. If the grace period expires, forces the process to exit with code 1.
 *
 * Registered via `app.enableShutdownHooks()` in `main.ts`.
 * NestJS resolves `OnApplicationShutdown` hooks automatically when the
 * application receives the shutdown signal.
 */
@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownService.name);
  private readonly gracePeriodMs = 30_000;

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.warn(
      `Received ${signal ?? 'unknown signal'} — starting graceful shutdown (${this.gracePeriodMs / 1_000}s deadline)`,
    );

    // Force-exit timer — if graceful shutdown exceeds the deadline, exit hard.
    const forceExitTimer = setTimeout(() => {
      this.logger.error(
        'Graceful shutdown deadline exceeded — forcing exit with code 1',
      );
      process.exit(1);
    }, this.gracePeriodMs);
    forceExitTimer.unref();

    try {
      // 1. Stop accepting new HTTP requests and drain in-flight connections.
      const httpServer = this.httpAdapterHost.httpAdapter?.getHttpServer();
      if (httpServer) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((err?: Error) => {
            if (err) reject(err);
            else resolve();
          });
        });
        this.logger.log('HTTP server closed — no longer accepting requests');
      }

      // 2. Close the database connection pool.
      try {
        const p = getDbPool();
        await p.end();
        this.logger.log('Database pool closed');
      } catch {
        this.logger.warn('Database pool not initialised — skipping pool close');
      }
    } finally {
      clearTimeout(forceExitTimer);
      this.logger.log('Graceful shutdown complete');
    }
  }
}