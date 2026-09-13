import { Inject, Injectable, OnApplicationShutdown, OnModuleInit, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { StorageProvider } from '@barghsa/shared/storage';
import { REDIS_CLIENT } from '../redis/index.js';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';
import { HttpAdapterHost } from '@nestjs/core';
import { closeDbPools } from '@barghsa/db';

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
 * The signal watchdog starts before Nest destroys modules or drains HTTP.
 * Redis and storage SDK connections close after accepted HTTP work drains.
 */
@Injectable()
export class ShutdownService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownService.name);
  private readonly gracePeriodMs: number;
  private draining = false;
  private httpServer: Server | undefined;
  private forceExitTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly signalHandlers = new Map<NodeJS.Signals, () => void>([
    ['SIGTERM', () => this.stopAccepting('SIGTERM')],
    ['SIGINT', () => this.stopAccepting('SIGINT')],
  ]);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    @Inject(STORAGE_PROVIDER) private readonly storage: Pick<StorageProvider, 'destroy'>
  ) {
    const raw = process.env['SHUTDOWN_GRACE_PERIOD_MS'] ?? '30000';
    const parsed = Number.parseInt(raw, 10);
    this.gracePeriodMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
  }

  onModuleInit(): void {
    for (const [signal, handler] of this.signalHandlers) process.prependListener(signal, handler);
    const server = this.httpAdapterHost.httpAdapter?.getHttpServer() as Server | undefined;
    this.httpServer = server;
    if (!server) return;
    const sockets = new Set<Socket>();
    const pending = new Map<Socket, number>();
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    server.prependListener('request', (req: IncomingMessage, res: ServerResponse) => {
      const socket = req.socket;
      pending.set(socket, (pending.get(socket) ?? 0) + 1);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        const remaining = (pending.get(socket) ?? 1) - 1;
        if (remaining) pending.set(socket, remaining);
        else pending.delete(socket);
        if (this.draining && !remaining) socket.end();
      };
      res.once('finish', finish);
      res.once('close', finish);
    });
    // res.end(buffer) is not proof that its bytes have flushed to the socket.
    server.closeIdleConnections = () => {
      for (const socket of sockets) if (!pending.has(socket)) socket.destroy();
    };
    const close = server.close.bind(server);
    server.close = (callback) => {
      this.startDeadline();
      return close(callback);
    };
  }

  private stopAccepting(signal: string): void {
    this.startDeadline(signal);
    if (this.httpServer?.listening) this.httpServer.close();
  }

  private startDeadline(signal?: string): void {
    this.draining = true;
    if (this.forceExitTimer) return;
    this.logger.warn(
      `Received ${signal ?? 'application close'} — starting graceful shutdown (${this.gracePeriodMs / 1_000}s deadline)`
    );
    this.forceExitTimer = setTimeout(() => {
      this.logger.error('Graceful shutdown deadline exceeded — forcing exit with code 1');
      process.exit(1);
    }, this.gracePeriodMs);
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    // Do not restart the deadline after Nest has already drained HTTP.
    this.startDeadline(signal);

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
      await closeDbPools();
      this.logger.log('Database pools closed');
    } catch {
      cleanShutdown = false;
      this.logger.warn('Database pool close failed');
    }

    try {
      if (this.redis) await this.redis.quit();
    } catch {
      cleanShutdown = false;
      this.logger.warn('Redis graceful close failed');
    } finally {
      this.redis?.disconnect();
    }
    try {
      this.storage.destroy?.();
    } catch {
      cleanShutdown = false;
      this.logger.warn('Storage connection close failed');
    }

    clearTimeout(this.forceExitTimer);
    this.forceExitTimer = undefined;
    for (const [name, handler] of this.signalHandlers) process.removeListener(name, handler);

    // Only force an exit when the shutdown was triggered by an OS signal
    // (SIGTERM, SIGINT).  Programmatic close from `app.close()` (e.g. the
    // generate-openapi script) should leave the exit code to the caller.
    if (signal) {
      if (cleanShutdown) {
        this.logger.log('Graceful shutdown complete');
        process.exit(0);
      } else {
        this.logger.error('Graceful shutdown completed with errors — exiting with code 1');
        process.exit(1);
      }
    } else if (!cleanShutdown) {
      this.logger.warn(
        'Graceful shutdown completed with errors (non-signal close — errors logged above)'
      );
    }
  }
}
