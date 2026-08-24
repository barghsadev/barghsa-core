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
 * The grace period is configurable via `SHUTDOWN_GRACE_PERIOD_MS` env var
 * (default 30_000).
 *
 * Registered via `app.enableShutdownHooks()` in `main.ts`.
 * NestJS resolves `OnApplicationShutdown` hooks automatically when the
 * application receives the shutdown signal.
 *
 * ## Deferred shutdown items
 *
 * - **Redis:** no connection factory exists yet. When wired (T-04.02.01),
 *   add `redis.quit()` before pool.end().
 * - **Object storage:** no client exists yet. When wired (T-04.03.xx),
 *   add `s3Client.destroy()` before pool.end().
 * - **Lease release:** lease infrastructure doesn't exist yet.
 *   When wired, add lease release before closing the pool.
 */
@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownService.name);
  private readonly gracePeriodMs: number;

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {
    const raw = process.env['SHUTDOWN_GRACE_PERIOD_MS'] ?? '30000';
    const parsed = Number.parseInt(raw, 10);
    this.gracePeriodMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.warn(
      `Received ${signal ?? 'unknown signal'} — starting graceful shutdown (${this.gracePeriodMs / 1_000}s deadline)`,
    );

    // Safety-net timer — if any step hangs, force exit.
    const forceExitTimer = setTimeout(() => {
      this.logger.error(
        'Graceful shutdown deadline exceeded — forcing exit with code 1',
      );
      process.exit(1);
    }, this.gracePeriodMs);
    forceExitTimer.unref();

    // Close each resource independently so a failure in one does not skip
    // subsequent cleanup steps.
    let cleanShutdown = true;

    // 1. Stop accepting new HTTP requests and drain in-flight connections.
    //    NestJS's app.close() also closes the HTTP adapter internally,
    //    so the manual close is best-effort. Guard against
    //    ERR_SERVER_NOT_RUNNING.
    try {
      const httpServer = this.httpAdapterHost.httpAdapter?.getHttpServer();
      if (httpServer?.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((err?: Error) => {
            if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
              reject(err);
            } else {
              resolve();
            }
          });
        });
        this.logger.log('HTTP server closed — no longer accepting requests');
      }
    } catch (err: unknown) {
      cleanShutdown = false;
      this.logger.error(`HTTP server close error: ${String(err)}`);
    }

    // 2. Close the database connection pool.
    try {
      const p = getDbPool();
      await p.end();
      this.logger.log('Database pool closed');
    } catch {
      cleanShutdown = false;
      this.logger.warn('Database pool not initialised — skipping pool close');
    }

    clearTimeout(forceExitTimer);

    if (cleanShutdown) {
      this.logger.log('Graceful shutdown complete');
      process.exit(0);
    } else {
      this.logger.error('Graceful shutdown completed with errors — exiting with code 1');
      process.exit(1);
    }
  }
}