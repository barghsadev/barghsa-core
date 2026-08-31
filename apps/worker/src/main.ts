import { getDbPool, createDbPool } from '@barghsa/db';
import { type Server as HttpServer, createServer } from 'node:http';
import { runOutboxPoll } from './notifications/outbox-runner.js';
import { collectNotificationGauges, exportWorkerMetrics } from './notifications/worker-metrics.js';
import { InAppNotificationTransport } from './notifications/in-app-transport.js';
import { scanServiceBreaches } from './service-targets/breach-scanner.js';
import { scanServiceEscalations } from './service-targets/escalation-scanner.js';
import { INVOICE_OVERDUE_JOB_TYPE, scanOverdueInvoices } from './invoices/overdue-scanner.js';
import {
  INVOICE_REMINDER_JOB_TYPE,
  scheduleIssuedInvoiceReminders,
} from './invoices/reminder-scheduler.js';
import {
  DEFAULT_REMINDER_SEND_INTERVAL_MS,
  INVOICE_REMINDER_SEND_JOB_TYPE,
  sendDueInvoiceReminders,
} from './invoices/reminder-sender.js';
import { recordJobFailure, recordJobSuccess } from './jobs/job-recorder.js';

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

  // ── Notification outbox poll loop (E-05, T-05.01.02 / T-05.02.01) ──────
  // Poll for due outbox rows, dispatch channels, and record outcomes.
  // The in-app transport is mandatory and always registered so every row that
  // requests `in_app` delivery lands a durable `in_app_notifications` row.
  const transports = { in_app: new InAppNotificationTransport() };
  const OUTBOX_POLL_MS = Number(process.env['OUTBOX_POLL_MS'] ?? '2000');
  const outboxPoller = setInterval(async () => {
    if (draining) return;
    try {
      const r = await runOutboxPoll({ transports });
      if (r.leased > 0) {
        logger.info(`Outbox poll: leased=${r.leased} delivered=${r.delivered} failed=${r.failed}`);
      }
      await recordJobSuccess('notification_outbox_poll');
    } catch (err) {
      logger.error(`Outbox poll failed: ${(err as Error)?.message ?? String(err)}`);
      await recordJobFailure({
        jobType: 'notification_outbox_poll',
        error: (err as Error)?.message ?? String(err),
        errorCategory: 'transient',
      });
    }
  }, OUTBOX_POLL_MS);
  outboxPoller.unref();

  // Stop the poller during graceful shutdown.
  process.on('SIGTERM', () => clearInterval(outboxPoller));
  process.on('SIGINT', () => clearInterval(outboxPoller));

  // ── Service breach scan loop (S-09.08, T-09.08.01) ────────────────────
  // Periodically checks open service items (tickets, verification cases)
  // against the admin-configured response targets and enqueues in-app staff
  // alerts (via the outbox above, so delivery reuses the same durable
  // pipeline). No-op when no config row exists, so a fresh installation is
  // silent until an admin configures targets.
  const BREACH_SCAN_DEFAULT_MS = 300000;
  const breachScanRaw = Number(process.env['SERVICE_BREACH_SCAN_MS'] ?? String(BREACH_SCAN_DEFAULT_MS));
  const SERVICE_BREACH_SCAN_MS =
    Number.isFinite(breachScanRaw) && breachScanRaw >= 1000
      ? breachScanRaw
      : BREACH_SCAN_DEFAULT_MS;
  if (SERVICE_BREACH_SCAN_MS !== breachScanRaw) {
    logger.warn(
      `Invalid SERVICE_BREACH_SCAN_MS '${process.env['SERVICE_BREACH_SCAN_MS'] ?? ''}' — falling back to ${BREACH_SCAN_DEFAULT_MS}ms`,
    );
  }
  let breachScanInFlight = false;
  const breachScanner = setInterval(async () => {
    if (draining || breachScanInFlight) return;
    breachScanInFlight = true;
    try {
      const result = await scanServiceBreaches();
      if (result.alerted > 0 || result.errors.length > 0) {
        logger.info(
          `Breach scan: alerted=${result.alerted} skipped=${result.skippedDuplicates} pruned=${result.pruned} errors=${result.errors.length}`,
        );
      }
      if (result.errors.length > 0) {
        await recordJobFailure({
          jobType: 'service_breach_scan',
          error: result.errors.map((e) => String(e)).join('; '),
          errorCategory: 'transient',
          payload: { errors: result.errors.length },
        });
      } else {
        await recordJobSuccess('service_breach_scan');
      }
    } catch (err) {
      logger.error(`Breach scan failed: ${(err as Error)?.message ?? String(err)}`);
      await recordJobFailure({
        jobType: 'service_breach_scan',
        error: (err as Error)?.message ?? String(err),
        errorCategory: 'transient',
      });
    } finally {
      breachScanInFlight = false;
    }
  }, SERVICE_BREACH_SCAN_MS);
  breachScanner.unref();

  process.on('SIGTERM', () => clearInterval(breachScanner));
  process.on('SIGINT', () => clearInterval(breachScanner));

  // ── Service escalation scan loop (S-09.08, T-09.08.03) ────────────────
  // Periodically advances un-responded breach episodes up the escalation
  // tiers (team lead, then admin) configured by the admin escalation policy
  // (app_config admin.escalation_policy). No-op when no config row exists,
  // so a fresh installation escalates nothing until an admin configures a
  // policy.
  const ESCALATION_SCAN_DEFAULT_MS = 300000;
  const escalationScanRaw = Number(process.env['SERVICE_ESCALATION_SCAN_MS'] ?? String(ESCALATION_SCAN_DEFAULT_MS));
  const SERVICE_ESCALATION_SCAN_MS =
    Number.isFinite(escalationScanRaw) && escalationScanRaw >= 1000
      ? escalationScanRaw
      : ESCALATION_SCAN_DEFAULT_MS;
  if (SERVICE_ESCALATION_SCAN_MS !== escalationScanRaw) {
    logger.warn(
      `Invalid SERVICE_ESCALATION_SCAN_MS '${process.env['SERVICE_ESCALATION_SCAN_MS'] ?? ''}' — falling back to ${ESCALATION_SCAN_DEFAULT_MS}ms`,
    );
  }
  let escalationScanInFlight = false;
  const escalationScanner = setInterval(async () => {
    if (draining || escalationScanInFlight) return;
    escalationScanInFlight = true;
    try {
      const result = await scanServiceEscalations();
      if (result.escalated.ticket.level2 + result.escalated.ticket.level3 +
          result.escalated.verification_case.level2 + result.escalated.verification_case.level3 > 0 ||
          result.errors.length > 0) {
        logger.info(
          `Escalation scan: ticket(l2=${result.escalated.ticket.level2},l3=${result.escalated.ticket.level3}) case(l2=${result.escalated.verification_case.level2},l3=${result.escalated.verification_case.level3}) errors=${result.errors.length}`,
        );
      }
      if (result.errors.length > 0) {
        await recordJobFailure({
          jobType: 'service_escalation_scan',
          error: result.errors.map((e) => String(e)).join('; '),
          errorCategory: 'transient',
          payload: { errors: result.errors.length },
        });
      } else {
        await recordJobSuccess('service_escalation_scan');
      }
    } catch (err) {
      logger.error(`Escalation scan failed: ${(err as Error)?.message ?? String(err)}`);
      await recordJobFailure({
        jobType: 'service_escalation_scan',
        error: (err as Error)?.message ?? String(err),
        errorCategory: 'transient',
      });
    } finally {
      escalationScanInFlight = false;
    }
  }, SERVICE_ESCALATION_SCAN_MS);
  escalationScanner.unref();

  process.on('SIGTERM', () => clearInterval(escalationScanner));
  process.on('SIGINT', () => clearInterval(escalationScanner));

  // ── Invoice overdue scan loop (S-04.1.03, T-04.1.03.04) ──────────────
  // Periodically marks Unpaid / Partially funded invoices whose dueAt is
  // strictly in the past as Overdue. No late fees; reminders continue.
  const OVERDUE_SCAN_DEFAULT_MS = 300000;
  const overdueScanRaw = Number(process.env['INVOICE_OVERDUE_SCAN_MS'] ?? String(OVERDUE_SCAN_DEFAULT_MS));
  const INVOICE_OVERDUE_SCAN_MS =
    Number.isFinite(overdueScanRaw) && overdueScanRaw >= 1000
      ? overdueScanRaw
      : OVERDUE_SCAN_DEFAULT_MS;
  if (INVOICE_OVERDUE_SCAN_MS !== overdueScanRaw) {
    logger.warn(
      `Invalid INVOICE_OVERDUE_SCAN_MS '${process.env['INVOICE_OVERDUE_SCAN_MS'] ?? ''}' — falling back to ${OVERDUE_SCAN_DEFAULT_MS}ms`,
    );
  }
  let overdueScanInFlight = false;
  const overdueScanner = setInterval(async () => {
    if (draining || overdueScanInFlight) return;
    overdueScanInFlight = true;
    try {
      const result = await scanOverdueInvoices();
      if (result.marked > 0 || result.errors.length > 0) {
        logger.info(
          `Overdue scan: marked=${result.marked} skipped=${result.skipped} scanned=${result.scanned} errors=${result.errors.length}`,
        );
      }
      if (result.errors.length > 0) {
        await recordJobFailure({
          jobType: INVOICE_OVERDUE_JOB_TYPE,
          error: result.errors.map((e) => String(e)).join('; '),
          errorCategory: 'transient',
          payload: { errors: result.errors.length, marked: result.marked },
        });
      } else {
        await recordJobSuccess(INVOICE_OVERDUE_JOB_TYPE);
      }
    } catch (err) {
      logger.error(`Overdue scan failed: ${(err as Error)?.message ?? String(err)}`);
      await recordJobFailure({
        jobType: INVOICE_OVERDUE_JOB_TYPE,
        error: (err as Error)?.message ?? String(err),
        errorCategory: 'transient',
      });
    } finally {
      overdueScanInFlight = false;
    }
  }, INVOICE_OVERDUE_SCAN_MS);
  overdueScanner.unref();

  process.on('SIGTERM', () => clearInterval(overdueScanner));
  process.on('SIGINT', () => clearInterval(overdueScanner));

  // ── Invoice reminder scheduler (S-04.1.04, T-04.1.04.02) ─────────────
  // Catch-up poll: issued invoices without schedule rows get reminder
  // datetimes computed from dueAt + canonical offsets and inserted.
  const REMINDER_SCHEDULE_DEFAULT_MS = 60_000;
  const reminderScheduleRaw = Number(
    process.env['INVOICE_REMINDER_SCHEDULE_MS'] ?? String(REMINDER_SCHEDULE_DEFAULT_MS),
  );
  const INVOICE_REMINDER_SCHEDULE_MS =
    Number.isFinite(reminderScheduleRaw) && reminderScheduleRaw >= 1000
      ? reminderScheduleRaw
      : REMINDER_SCHEDULE_DEFAULT_MS;
  if (INVOICE_REMINDER_SCHEDULE_MS !== reminderScheduleRaw) {
    logger.warn(
      `Invalid INVOICE_REMINDER_SCHEDULE_MS '${process.env['INVOICE_REMINDER_SCHEDULE_MS'] ?? ''}' — falling back to ${REMINDER_SCHEDULE_DEFAULT_MS}ms`,
    );
  }
  let reminderScheduleInFlight = false;
  const reminderScheduler = setInterval(async () => {
    if (draining || reminderScheduleInFlight) return;
    reminderScheduleInFlight = true;
    try {
      const result = await scheduleIssuedInvoiceReminders();
      if (result.scheduled > 0 || result.errors.length > 0) {
        logger.info(
          `Reminder schedule: scheduled=${result.scheduled} skipped=${result.skipped} scanned=${result.scanned} errors=${result.errors.length}`,
        );
      }
      if (result.errors.length > 0) {
        await recordJobFailure({
          jobType: INVOICE_REMINDER_JOB_TYPE,
          error: result.errors.map((e) => String(e)).join('; '),
          errorCategory: 'transient',
          payload: { errors: result.errors.length, scheduled: result.scheduled },
        });
      } else {
        await recordJobSuccess(INVOICE_REMINDER_JOB_TYPE);
      }
    } catch (err) {
      logger.error(`Reminder schedule failed: ${(err as Error)?.message ?? String(err)}`);
      await recordJobFailure({
        jobType: INVOICE_REMINDER_JOB_TYPE,
        error: (err as Error)?.message ?? String(err),
        errorCategory: 'transient',
      });
    } finally {
      reminderScheduleInFlight = false;
    }
  }, INVOICE_REMINDER_SCHEDULE_MS);
  reminderScheduler.unref();

  process.on('SIGTERM', () => clearInterval(reminderScheduler));
  process.on('SIGINT', () => clearInterval(reminderScheduler));

  // ── Invoice reminder sender (S-04.1.04, T-04.1.04.03) ────────────────
  // Hourly cron: due `scheduled` reminder rows are claimed, invoice state
  // is re-checked, and delivery is written through the notification outbox.
  const reminderSendRaw = Number(
    process.env['INVOICE_REMINDER_SEND_MS'] ?? String(DEFAULT_REMINDER_SEND_INTERVAL_MS),
  );
  const INVOICE_REMINDER_SEND_MS =
    Number.isFinite(reminderSendRaw) && reminderSendRaw >= 1000
      ? reminderSendRaw
      : DEFAULT_REMINDER_SEND_INTERVAL_MS;
  if (INVOICE_REMINDER_SEND_MS !== reminderSendRaw) {
    logger.warn(
      `Invalid INVOICE_REMINDER_SEND_MS '${process.env['INVOICE_REMINDER_SEND_MS'] ?? ''}' — falling back to ${DEFAULT_REMINDER_SEND_INTERVAL_MS}ms`,
    );
  }
  let reminderSendInFlight = false;
  const reminderSender = setInterval(async () => {
    if (draining || reminderSendInFlight) return;
    reminderSendInFlight = true;
    try {
      const result = await sendDueInvoiceReminders();
      if (result.sent > 0 || result.errors.length > 0) {
        logger.info(
          `Reminder send: sent=${result.sent} skipped=${result.skipped} scanned=${result.scanned} errors=${result.errors.length}`,
        );
      }
      if (result.errors.length > 0) {
        await recordJobFailure({
          jobType: INVOICE_REMINDER_SEND_JOB_TYPE,
          error: result.errors.map((e) => String(e)).join('; '),
          errorCategory: 'transient',
          payload: { errors: result.errors.length, sent: result.sent },
        });
      } else {
        await recordJobSuccess(INVOICE_REMINDER_SEND_JOB_TYPE);
      }
    } catch (err) {
      logger.error(`Reminder send failed: ${(err as Error)?.message ?? String(err)}`);
      await recordJobFailure({
        jobType: INVOICE_REMINDER_SEND_JOB_TYPE,
        error: (err as Error)?.message ?? String(err),
        errorCategory: 'transient',
      });
    } finally {
      reminderSendInFlight = false;
    }
  }, INVOICE_REMINDER_SEND_MS);
  reminderSender.unref();

  process.on('SIGTERM', () => clearInterval(reminderSender));
  process.on('SIGINT', () => clearInterval(reminderSender));

  logger.info(
    'Worker initialised — outbox poll loop + breach scan + escalation scan + invoice overdue scan + invoice reminder scheduler + invoice reminder sender active',
  );
}

void main().catch((err: unknown) => {
  logger.error(`Fatal worker error: ${String(err)}`);
  process.exit(1);
});