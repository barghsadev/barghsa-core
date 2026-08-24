import { getDbPool } from './index.js'

// ---------------------------------------------------------------------------
// Type definitions for PostgreSQL performance metrics collected from system
// views.  Each metric function returns a record of Prometheus-friendly
// gauge / counter values keyed by metric name.
// ---------------------------------------------------------------------------

export interface DatabaseMetrics {
  /** Global database-level counters from pg_stat_database */
  database: {
    xact_commit: number
    xact_rollback: number
    blks_read: number
    blks_hit: number
    tup_returned: number
    tup_fetched: number
    tup_inserted: number
    tup_updated: number
    tup_deleted: number
    conflicts: number
    deadlocks: number
    blk_read_time: number
    blk_write_time: number
    temp_files: number
    temp_bytes: number
  }
  /** Cache hit ratio (0–1), calculated from blks_hit / (blks_hit + blks_read) */
  cacheHitRatio: number
  /** Connection pool saturation (0–1) — total client connections / PG max_connections */
  connectionSaturation: number
  /** PostgreSQL server max_connections setting */
  maxConnections: number
  /** Number of active connections currently executing a query */
  activeConnections: number
  /** Number of idle-in-transaction connections (potential issues) */
  idleInTransaction: number
  /** Number of connections waiting on a lock */
  waitingConnections: number
  /** Long-running queries (>= the given threshold) */
  longRunningQueries: Array<{
    pid: number
    query: string
    durationSeconds: number
    state: string
    waitEvent: string | null
  }>
  /** WAL metrics from pg_stat_wal (PG 14+) */
  wal: {
    wal_records: number
    wal_fpi: number
    wal_bytes: number
    wal_buffers_full: number
    wal_write: number
    wal_sync: number
    wal_write_time: number
    wal_sync_time: number
  } | null
  /** Background writer stats from pg_stat_bgwriter */
  bgwriter: {
    checkpoints_timed: number
    checkpoints_req: number
    checkpoint_write_time: number
    checkpoint_sync_time: number
    buffers_checkpoint: number
    buffers_clean: number
    maxwritten_clean: number
    buffers_backend: number
    buffers_backend_fsync: number
    buffers_alloc: number
    stats_reset: string | null
  } | null
  /** Query performance metrics from pg_stat_statements (top-N by total_time) */
  topQueries: Array<{
    queryId: string
    query: string
    calls: number
    totalTimeMs: number
    meanTimeMs: number
    rows: number
    sharedBlksHit: number
    sharedBlksRead: number
    sharedBlksDirtied: number
    sharedBlksWritten: number
    localBlksHit: number
    localBlksRead: number
    tempBlksRead: number
    tempBlksWritten: number
    blkReadTimeMs: number
    blkWriteTimeMs: number
  }> | null
}

export interface MetricsResult {
  ok: boolean
  metrics: DatabaseMetrics | null
  error?: string
  latencyMs: number
}

const SLOW_QUERY_THRESHOLD_SECONDS = 30

/**
 * Collect replication lag from pg_stat_replication.
 * Returns the lag in seconds, or null if no replica is configured / not streaming.
 * This is queried separately from the main metrics to isolate failures.
 */
export async function collectReplicationLag(): Promise<number | null> {
  try {
    const pool = getDbPool()
    const result = await pool.query(`
      SELECT
        COALESCE(
          EXTRACT(EPOCH FROM replay_lag),
          EXTRACT(EPOCH FROM write_lag),
          EXTRACT(EPOCH FROM flush_lag),
          0
        ) AS lag_seconds
      FROM pg_stat_replication
      WHERE state = 'streaming'
      LIMIT 1
    `)
    if (result.rows.length === 0) return null
    return Number(result.rows[0].lag_seconds)
  } catch {
    return null
  }
}

/**
 * Collect all performance metrics from PostgreSQL system views.
 *
 * This queries:
 *   - pg_stat_database for global counters
 *   - pg_stat_activity for connection/query state
 *   - pg_stat_bgwriter for checkpoint/buffer stats
 *   - pg_stat_wal for WAL write metrics
 *   - pg_stat_statements for top-N query performance
 *   - pg_settings for server max_connections
 *
 * Each query is isolated — a failure in one view does not block others.
 * Returns a MetricsResult with the full metric set or an error.
 */
export async function collectPerformanceMetrics(
  topN = 10,
  slowThresholdSeconds = SLOW_QUERY_THRESHOLD_SECONDS,
): Promise<MetricsResult> {
  const startedAt = Date.now()

  const pool = getDbPool()

  try {
    // Query pg_stat_database for the barghsa database
    const dbStats = pool.query(`
      SELECT
        xact_commit,
        xact_rollback,
        blks_read,
        blks_hit,
        tup_returned,
        tup_fetched,
        tup_inserted,
        tup_updated,
        tup_deleted,
        conflicts,
        deadlocks,
        blk_read_time,
        blk_write_time,
        temp_files,
        temp_bytes,
        numbackends,
        datname
      FROM pg_stat_database
      WHERE datname = current_database()
    `)

    // Query pg_stat_activity for connection state
    const activityStats = pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE state = 'active') AS active_connections,
        COUNT(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_transaction,
        COUNT(*) FILTER (WHERE wait_event_type = 'Lock') AS waiting_connections,
        COUNT(*) AS total_connections
      FROM pg_stat_activity
      WHERE backend_type = 'client backend'
        AND pid <> pg_backend_pid()
    `)

    // Query long-running queries
    const longRunningStats = pool.query(`
      SELECT
        pid,
        query,
        round(extract(EPOCH FROM now() - query_start)::numeric, 1) AS duration_seconds,
        state,
        wait_event
      FROM pg_stat_activity
      WHERE backend_type = 'client backend'
        AND state = 'active'
        AND query_start IS NOT NULL
        AND extract(EPOCH FROM now() - query_start) >= $1::numeric
        AND pid <> pg_backend_pid()
      ORDER BY duration_seconds DESC
      LIMIT 20
    `, [String(slowThresholdSeconds)])

    // Query pg_stat_bgwriter
    const bgwriterStats = pool.query(`
      SELECT
        checkpoints_timed,
        checkpoints_req,
        checkpoint_write_time,
        checkpoint_sync_time,
        buffers_checkpoint,
        buffers_clean,
        maxwritten_clean,
        buffers_backend,
        buffers_backend_fsync,
        buffers_alloc,
        stats_reset
      FROM pg_stat_bgwriter
    `)

    // Query pg_stat_wal (PG 14+)
    const walStats = pool.query(`
      SELECT
        wal_records,
        wal_fpi,
        wal_bytes,
        wal_buffers_full,
        wal_write,
        wal_sync,
        wal_write_time,
        wal_sync_time
      FROM pg_stat_wal
    `)

    // Query pg_stat_statements for top-N by total time
    const queryStats = pool.query(`
      SELECT
        queryid,
        left(query, 200) AS query,
        calls,
        total_exec_time,
        total_exec_time / NULLIF(calls, 0) AS mean_exec_time,
        rows,
        shared_blks_hit,
        shared_blks_read,
        shared_blks_dirtied,
        shared_blks_written,
        local_blks_hit,
        local_blks_read,
        temp_blks_read,
        temp_blks_written,
        blk_read_time,
        blk_write_time
      FROM pg_stat_statements
      WHERE calls > 0
      ORDER BY total_exec_time DESC
      LIMIT $1::integer
    `, [String(topN)])

    // Query server max_connections from pg_settings
    const maxConnResult = pool.query(`
      SELECT setting::integer AS max_connections
      FROM pg_settings
      WHERE name = 'max_connections'
    `)

    // Use allSettled so a single failing view doesn't kill all metrics
    const settled = await Promise.allSettled([
      dbStats, activityStats, longRunningStats,
      bgwriterStats, walStats, queryStats, maxConnResult,
    ])

    const [
      dbResultSettled,
      activityResultSettled,
      longRunningResultSettled,
      bgwriterResultSettled,
      walResultSettled,
      queryResultSettled,
      maxConnResultSettled,
    ] = settled

    // Gracefully handle each query result, defaulting to empty/null on failure
    const dbResult = dbResultSettled.status === 'fulfilled' ? dbResultSettled.value : { rows: [] }
    const activityResult = activityResultSettled.status === 'fulfilled' ? activityResultSettled.value : { rows: [] }
    const longRunningResult = longRunningResultSettled.status === 'fulfilled' ? longRunningResultSettled.value : { rows: [] }
    const bgwriterResult = bgwriterResultSettled.status === 'fulfilled' ? bgwriterResultSettled.value : { rows: [] }
    const walResult = walResultSettled.status === 'fulfilled' ? walResultSettled.value : { rows: [] }
    const queryResult = queryResultSettled.status === 'fulfilled' ? queryResultSettled.value : { rows: [] }

    const maxConn = maxConnResultSettled.status === 'fulfilled' && maxConnResultSettled.value.rows.length > 0
      ? Number(maxConnResultSettled.value.rows[0].max_connections)
      : pool.options?.max ?? 100

    const dbRow = dbResult.rows[0] ?? null
    const actRow = activityResult.rows[0] ?? null
    const maxConnections = maxConn

    const blksHit = Number(dbRow?.blks_hit ?? 0)
    const blksRead = Number(dbRow?.blks_read ?? 0)
    const totalBlks = blksHit + blksRead
    const cacheHitRatio = totalBlks > 0 ? blksHit / totalBlks : 1

    const totalConnections = Number(actRow?.total_connections ?? 0)
    const connectionSaturation = maxConnections > 0
      ? totalConnections / maxConnections
      : 0

    const metrics: DatabaseMetrics = {
      database: {
        xact_commit: Number(dbRow?.xact_commit ?? 0),
        xact_rollback: Number(dbRow?.xact_rollback ?? 0),
        blks_read: blksRead,
        blks_hit: blksHit,
        tup_returned: Number(dbRow?.tup_returned ?? 0),
        tup_fetched: Number(dbRow?.tup_fetched ?? 0),
        tup_inserted: Number(dbRow?.tup_inserted ?? 0),
        tup_updated: Number(dbRow?.tup_updated ?? 0),
        tup_deleted: Number(dbRow?.tup_deleted ?? 0),
        conflicts: Number(dbRow?.conflicts ?? 0),
        deadlocks: Number(dbRow?.deadlocks ?? 0),
        blk_read_time: Number(dbRow?.blk_read_time ?? 0),
        blk_write_time: Number(dbRow?.blk_write_time ?? 0),
        temp_files: Number(dbRow?.temp_files ?? 0),
        temp_bytes: Number(dbRow?.temp_bytes ?? 0),
      },
      cacheHitRatio,
      connectionSaturation,
      activeConnections: Number(actRow?.active_connections ?? 0),
      idleInTransaction: Number(actRow?.idle_in_transaction ?? 0),
      waitingConnections: Number(actRow?.waiting_connections ?? 0),
      longRunningQueries: (longRunningResult?.rows ?? []).map((r: Record<string, unknown>) => ({
        pid: Number(r.pid),
        query: String(r.query ?? ''),
        durationSeconds: Number(r.duration_seconds ?? 0),
        state: String(r.state ?? ''),
        waitEvent: r.wait_event ? String(r.wait_event) : null,
      })),
      wal: walResult.rows[0]
        ? {
            wal_records: Number(walResult.rows[0].wal_records ?? 0),
            wal_fpi: Number(walResult.rows[0].wal_fpi ?? 0),
            wal_bytes: Number(walResult.rows[0].wal_bytes ?? 0),
            wal_buffers_full: Number(walResult.rows[0].wal_buffers_full ?? 0),
            wal_write: Number(walResult.rows[0].wal_write ?? 0),
            wal_sync: Number(walResult.rows[0].wal_sync ?? 0),
            wal_write_time: Number(walResult.rows[0].wal_write_time ?? 0),
            wal_sync_time: Number(walResult.rows[0].wal_sync_time ?? 0),
          }
        : null,
      bgwriter: bgwriterResult.rows[0]
        ? {
            checkpoints_timed: Number(bgwriterResult.rows[0].checkpoints_timed ?? 0),
            checkpoints_req: Number(bgwriterResult.rows[0].checkpoints_req ?? 0),
            checkpoint_write_time: Number(bgwriterResult.rows[0].checkpoint_write_time ?? 0),
            checkpoint_sync_time: Number(bgwriterResult.rows[0].checkpoint_sync_time ?? 0),
            buffers_checkpoint: Number(bgwriterResult.rows[0].buffers_checkpoint ?? 0),
            buffers_clean: Number(bgwriterResult.rows[0].buffers_clean ?? 0),
            maxwritten_clean: Number(bgwriterResult.rows[0].maxwritten_clean ?? 0),
            buffers_backend: Number(bgwriterResult.rows[0].buffers_backend ?? 0),
            buffers_backend_fsync: Number(bgwriterResult.rows[0].buffers_backend_fsync ?? 0),
            buffers_alloc: Number(bgwriterResult.rows[0].buffers_alloc ?? 0),
            stats_reset: bgwriterResult.rows[0].stats_reset
              ? String(bgwriterResult.rows[0].stats_reset)
              : null,
          }
        : null,
      topQueries: (queryResult?.rows ?? []).map((r: Record<string, unknown>) => ({
        queryId: String(r.queryid ?? ''),
        query: String(r.query ?? ''),
        calls: Number(r.calls ?? 0),
        totalTimeMs: Number(r.total_exec_time ?? 0),
        meanTimeMs: Number(r.mean_exec_time ?? 0),
        rows: Number(r.rows ?? 0),
        sharedBlksHit: Number(r.shared_blks_hit ?? 0),
        sharedBlksRead: Number(r.shared_blks_read ?? 0),
        sharedBlksDirtied: Number(r.shared_blks_dirtied ?? 0),
        sharedBlksWritten: Number(r.shared_blks_written ?? 0),
        localBlksHit: Number(r.local_blks_hit ?? 0),
        localBlksRead: Number(r.local_blks_read ?? 0),
        tempBlksRead: Number(r.temp_blks_read ?? 0),
        tempBlksWritten: Number(r.temp_blks_written ?? 0),
        blkReadTimeMs: Number(r.blk_read_time ?? 0),
        blkWriteTimeMs: Number(r.blk_write_time ?? 0),
      })),
    }

    return {
      ok: true,
      metrics,
      latencyMs: Date.now() - startedAt,
    }
  } catch (err) {
    return {
      ok: false,
      metrics: null,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - startedAt,
    }
  }
}
