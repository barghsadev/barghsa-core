import { getDbPool, createDbPool } from '@barghsa/db';
import { type Server as HttpServer, createServer } from 'node:http';
import { runOutboxPoll } from './notifications/outbox-runner.js';
import { collectNotificationGauges, exportWorkerMetrics } from './notifications/worker-metrics.js';

/**
 * Grace period in milliseconds. Configurable via `SHUTDOWN_GRACE_PERIOD_MS`
 * env var (default 30000 / 30s).
 */
const GRACE_PERIOD_MS = (() => {
  const raw = process.env['SHUTDOWN_GRACE_PERIOD_MS'] ?? '30000';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
})();

const logger = {
  info: (msg: string): void => console.log(`[worker] ${msg}`),
  warn: (msg: string): void => console.warn(`[worker] ${msg}`),
  error: (msg: string): void => console.error(`[worker] ${msg}`),
};

/**
 * Barghsa background worker process.
 *
 * Handles off-request-path workloads: scheduled jobs, queue processing,
 * data synchronisation, and periodic maintenance tasks.
 *
 * Graceful shutdown (SIGTERM):
 * 1. Stop leasing new jobs (mark the process as draining).
 * 2. Wait for the currently running job to finish (or timeout).
 * 3. Close the database connection pool.
 * 4. Exit cleanly with code 0, or code 1 if the grace period expires.
 *
 * ## Deferred shutdown items
 *
 * - **Redis:** no connection factory exists yet. When wired (T-04.02.01),
 *   add `redis.quit()` before pool.end().
 * - **Lease release:** lease infrastructure doesn't exist yet.
 *   When wired, add lease release before closing the pool.
 */
async function main(): Promise<void> {
  logger.info('Worker starting');

  // Initialise the database connection pool.
  createDbPool();
  logger.info('Database pool initialised');

  // Expose a health-check endpoint (`/health` and `/`) for container
  // orchestration plus a Prometheus `/metrics` endpoint carrying the
  // notification observability gauges/counters (E-05, T-05.01.07).
  const server = createServer(async (req, res) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname === '/metrics') {
      try {
        await collectNotificationGauges(getDbPool());
        const body = await exportWorkerMetrics();
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(body);
      } catch (err) {
        logger.error(`Metrics scrape failed: ${(err as Error)?.message ?? String(err)}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', service: 'worker' }));
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
  });

  const port = parseInt(process.env['WORKER_PORT'] ?? '9090', 10);
  server.listen(port, () => {
    logger.info(`Worker health server listening on port ${port}`);
  });

  // Track whether a job is in-flight.
  let draining = false;
  let currentJob: Promise<void> | null = null;

  /* ------------------------------------------------------------------ */
  /*  Graceful shutdown handler                                          */
  /* ------------------------------------------------------------------ */

  function shutdown(signal: string): void {
    if (draining) return; // already shutting down
    draining = true;

    logger.warn(
      `Received ${signal} — starting graceful shutdown (${GRACE_PERIOD_MS / 1_000}s deadline)`,
    );

    const forceExitTimer = setTimeout(() => {
      logger.error('Graceful shutdown deadline exceeded — forcing exit with code 1');
      process.exit(1);
    }, GRACE_PERIOD_MS);
    forceExitTimer.unref();

    // 1. Stop accepting new jobs / health-check requests — drain connections.
    const closeServer = new Promise<void>((resolve) => {
      server.close(() => {
        logger.info('Health server closed — no longer accepting requests');
        resolve();
      });
    });

    // 2. Wait for the in-flight job to finish.
    const waitForJob = currentJob ?? Promise.resolve();

    // 3. Drain server, close pool, then exit.
    void Promise.all([closeServer, waitForJob])
      .then(() => {
        const p = getDbPool();
        return p.end();
      })
      .then(() => {
        clearTimeout(forceExitTimer);
        logger.info('Graceful shutdown complete — exiting with code 0');
        process.exit(0);
      })
      .catch((err: unknown) => {
        clearTimeout(forceExitTimer);
        logger.error(`Shutdown error: ${String(err)}`);
        process.exit(1);
      });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Prevent uncaught exceptions from silently killing the process.
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${String(reason)}`);
  });

  // ── Notification outbox poll loop (E-05, T-05.01.02) ───────────────
  // Poll for due outbox rows, dispatch channels, and record outcomes.
  // The loop captures `draining` by reference so a graceful shutdown stops
  // leasing new work. Sending-only at this stage; retry/backoff scheduling
  // (T-05.01.03) later extends the poll cadence.
  const OUTBOX_POLL_MS = Number(process.env['OUTBOX_POLL_MS'] ?? '2000');
  const outboxPoller = setInterval(async () => {
    if (draining) return;
    try {
      const r = await runOutboxPoll();
      if (r.leased > 0) {
        logger.info(`Outbox poll: leased=${r.leased} delivered=${r.delivered} failed=${r.failed}`);
      }
    } catch (err) {
      logger.error(`Outbox poll failed: ${(err as Error)?.message ?? String(err)}`);
    }
  }, OUTBOX_POLL_MS);
  outboxPoller.unref();

  // Stop the poller during graceful shutdown.
  process.on('SIGTERM', () => clearInterval(outboxPoller));
  process.on('SIGINT', () => clearInterval(outboxPoller));

  logger.info('Worker initialised — outbox poll loop active');
}

void main().catch((err: unknown) => {
  logger.error(`Fatal worker error: ${String(err)}`);
  process.exit(1);
});