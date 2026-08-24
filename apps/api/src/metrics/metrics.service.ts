import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { collectPerformanceMetrics, type DatabaseMetrics } from '@barghsa/db'
import promClient from 'prom-client'

/**
 * NestJS service that registers and updates Prometheus metrics for PostgreSQL
 * performance monitoring.  Metrics are pulled from PG system views via
 * collectPerformanceMetrics() on each scrape.
 *
 * Registers gauges for:
 *   - pg_cache_hit_ratio
 *   - pg_connection_saturation
 *   - pg_active_connections
 *   - pg_idle_in_transaction
 *   - pg_waiting_connections
 *   - pg_long_running_queries
 *   - pg_deadlocks_total
 *   - pg_temp_files_total
 *   - pg_xact_commit_total
 *   - pg_xact_rollback_total
 *   - pg_cache_hit_total
 *   - pg_cache_read_total
 *   - pg_checkpoints_timed_total
 *   - pg_checkpoints_req_total
 *   - pg_wal_bytes_total
 *   - pg_wal_records_total
 *   - pg_top_query_duration_seconds — labeled by queryid
 *
 * In production, scraped by the monitoring stack (Prometheus + alertmanager).
 * In development, available at GET /metrics.
 */
@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name)
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private lastMetrics: DatabaseMetrics | null = null

  // Polling interval (ms).  In production, metrics are updated on each scrape
  // by the controller; the poll interval controls how fresh the cached values
  // are.  Default: 15 seconds.
  private readonly POLL_INTERVAL_MS = 15_000

  // ── Prometheus metric registrations ──────────────────────────────

  private readonly cacheHitRatio = new promClient.Gauge({
    name: 'pg_cache_hit_ratio',
    help: 'PostgreSQL cache hit ratio (0–1)',
  })
  private readonly connectionSaturation = new promClient.Gauge({
    name: 'pg_connection_saturation',
    help: 'PostgreSQL connection pool saturation (0–1)',
  })
  private readonly activeConnections = new promClient.Gauge({
    name: 'pg_active_connections',
    help: 'Number of active PostgreSQL connections',
  })
  private readonly idleInTransaction = new promClient.Gauge({
    name: 'pg_idle_in_transaction_connections',
    help: 'Number of idle-in-transaction connections',
  })
  private readonly waitingConnections = new promClient.Gauge({
    name: 'pg_waiting_connections',
    help: 'Number of connections waiting on a lock',
  })
  private readonly longRunningQueries = new promClient.Gauge({
    name: 'pg_long_running_queries',
    help: 'Number of queries running longer than 30 seconds',
  })
  private readonly deadlocksTotal = new promClient.Gauge({
    name: 'pg_deadlocks_total',
    help: 'Total number of detected deadlocks',
  })
  private readonly tempFilesTotal = new promClient.Gauge({
    name: 'pg_temp_files_total',
    help: 'Total number of temporary files created',
  })
  private readonly xactCommitTotal = new promClient.Gauge({
    name: 'pg_xact_commit_total',
    help: 'Total number of transactions committed',
  })
  private readonly xactRollbackTotal = new promClient.Gauge({
    name: 'pg_xact_rollback_total',
    help: 'Total number of transactions rolled back',
  })
  private readonly cacheHitTotal = new promClient.Gauge({
    name: 'pg_cache_hit_total',
    help: 'Total number of shared block cache hits',
  })
  private readonly cacheReadTotal = new promClient.Gauge({
    name: 'pg_cache_read_total',
    help: 'Total number of shared block reads from disk',
  })
  private readonly checkpointsTimedTotal = new promClient.Gauge({
    name: 'pg_checkpoints_timed_total',
    help: 'Total number of scheduled checkpoints',
  })
  private readonly checkpointsReqTotal = new promClient.Gauge({
    name: 'pg_checkpoints_req_total',
    help: 'Total number of requested checkpoints',
  })
  private readonly walBytesTotal = new promClient.Gauge({
    name: 'pg_wal_bytes_total',
    help: 'Total WAL data written in bytes',
  })
  private readonly walRecordsTotal = new promClient.Gauge({
    name: 'pg_wal_records_total',
    help: 'Total number of WAL records generated',
  })
  private readonly topQueryDuration = new promClient.Gauge({
    name: 'pg_top_query_duration_seconds',
    help: 'Mean execution time in seconds for top queries (labeled by queryid)',
    labelNames: ['queryid', 'query_preview'] as const,
  })

  constructor() {
    // Register default Node.js / runtime metrics
    promClient.collectDefaultMetrics({ prefix: 'node_' })
  }

  onModuleInit(): void {
    this.logger.log('Initialising PostgreSQL performance metrics')

    // Start a background poll loop so metrics converge quickly even
    // without a scrape.  The controller's collect() call also triggers
    // a fresh poll synchronously before serving.
    void this.poll()

    this.pollTimer = setInterval(() => {
      void this.poll()
    }, this.POLL_INTERVAL_MS)
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /**
   * Collect / refresh all PG metrics and return the Prometheus register's
   * text content.  Called by the /metrics controller on each HTTP scrape.
   */
  async collect(): Promise<string> {
    await this.poll()
    return promClient.register.metrics()
  }

  /** Return the last known metrics snapshot (for health / debug). */
  getLastMetrics(): DatabaseMetrics | null {
    return this.lastMetrics
  }

  // ── Internal: poll PG and push to Prometheus gauges ─────────────

  private async poll(): Promise<void> {
    try {
      const result = await collectPerformanceMetrics(10, 30)
      if (!result.ok || !result.metrics) {
        this.logger.warn(`Metrics collection failed: ${result.error ?? 'unknown'}`)
        return
      }

      const m = result.metrics
      this.lastMetrics = m

      this.cacheHitRatio.set(m.cacheHitRatio)
      this.connectionSaturation.set(m.connectionSaturation)
      this.activeConnections.set(m.activeConnections)
      this.idleInTransaction.set(m.idleInTransaction)
      this.waitingConnections.set(m.waitingConnections)
      this.longRunningQueries.set(m.longRunningQueries.length)
      this.deadlocksTotal.set(m.database.deadlocks)
      this.tempFilesTotal.set(m.database.temp_files)
      this.xactCommitTotal.set(m.database.xact_commit)
      this.xactRollbackTotal.set(m.database.xact_rollback)
      this.cacheHitTotal.set(m.database.blks_hit)
      this.cacheReadTotal.set(m.database.blks_read)
      this.walBytesTotal.set(m.wal?.wal_bytes ?? 0)
      this.walRecordsTotal.set(m.wal?.wal_records ?? 0)

      if (m.bgwriter) {
        this.checkpointsTimedTotal.set(m.bgwriter.checkpoints_timed)
        this.checkpointsReqTotal.set(m.bgwriter.checkpoints_req)
      }

      // Top queries — reset before re-labelling
      this.topQueryDuration.reset()
      for (const q of m.topQueries ?? []) {
        const preview = q.query.length > 80 ? q.query.slice(0, 77) + '...' : q.query
        this.topQueryDuration.set(
          { queryid: q.queryId, query_preview: preview },
          q.meanTimeMs / 1000,
        )
      }
    } catch (err) {
      this.logger.error(
        `Metrics poll error: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}