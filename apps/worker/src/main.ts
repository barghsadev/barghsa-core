import { getDbPool, createDbPool } from '@barghsa/db';
import { type Server as HttpServer, createServer } from 'node:http';

const GRACE_PERIOD_MS = 30_000;

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
 */
async function main(): Promise<void> {
  logger.info('Worker starting');

  // Initialise the database connection pool.
  createDbPool();
  logger.info('Database pool initialised');

  // Expose a minimal health-check endpoint for container orchestration.
  const server = createServer((_req, res) => {
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

    // 1. Stop accepting new jobs / health-check requests.
    server.close(() => {
      logger.info('Health server closed — no longer accepting requests');
    });

    // 2. Wait for the in-flight job to finish.
    const waitForJob = currentJob ?? Promise.resolve();

    // 3. Close database pool and exit.
    void waitForJob
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
    process.exitCode = 1;
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${String(reason)}`);
  });

  // ── Worker loop placeholder ────────────────────────────────────
  // TODO(T-04.xx.xx): Wire actual job leasing and execution here.
  //
  // Example:
  //   while (!draining) {
  //     const job = await leaseJob(db);
  //     if (!job) { await sleep(1_000); continue; }
  //     currentJob = executeJob(job);
  //     try { await currentJob; } catch (e) { ... }
  //     await releaseJob(job);
  //     currentJob = null;
  //   }

  logger.info('Worker initialised — awaiting job loop setup');
}

void main().catch((err: unknown) => {
  logger.error(`Fatal worker error: ${String(err)}`);
  process.exit(1);
});