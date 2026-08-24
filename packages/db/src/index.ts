import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool, type Client } from 'pg'

let pool: Pool | null = null

export interface DbPoolConfig {
  databaseUrl?: string
  poolMin?: number
  poolMax?: number
  idleTimeoutMillis?: number
  connectionTimeoutMillis?: number
  statementTimeout?: string
  lockTimeout?: string
  idleTransactionTimeout?: string
  queryTimeout?: number
}

const DEFAULT_STATEMENT_TIMEOUT = '30s'
const DEFAULT_LOCK_TIMEOUT = '5s'
const DEFAULT_IDLE_TX_TIMEOUT = '60s'
const SLOW_QUERY_THRESHOLD_MS = 200
const DEFAULT_QUERY_TIMEOUT = 30_000

/**
 * Emit a structured (single-line JSON) log entry. Development keeps plain
 * logging; production writes structured JSON only.
 */
function structuredLog(level: 'warn' | 'error', event: string, details: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== 'production') return
  // Structured JSON only in production; single line per entry for log aggregation.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level, event, ...details }))
}

/**
 * Build a PostgreSQL connection string with GUC parameters encoded in the
 * `options` query parameter. These are applied at session startup before
 * any user query runs, which avoids the race condition of using the async
 * pool `connect` event for SET statements.
 */
export function buildConnectionString(
  baseUrl: string | undefined,
  overrides: {
    statementTimeout?: string
    lockTimeout?: string
    idleTransactionTimeout?: string
  },
): string {
  const url = baseUrl ?? process.env.DATABASE_URL
  if (!url) return '' // Pool will fail with a clear error

  const st = overrides.statementTimeout ?? DEFAULT_STATEMENT_TIMEOUT
  const lt = overrides.lockTimeout ?? DEFAULT_LOCK_TIMEOUT
  const itt = overrides.idleTransactionTimeout ?? DEFAULT_IDLE_TX_TIMEOUT

  const gucOptions = `-c statement_timeout=${st} -c lock_timeout=${lt} -c idle_in_transaction_session_timeout=${itt}`
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}options=${encodeURIComponent(gucOptions)}`
}

/**
 * Wrap a client's query method so that in production we measure execution
 * duration and emit a structured JSON warning for slow queries, and in any
 * environment enforce a client-side query timeout that cancels the query
 * server-side via the PostgreSQL cancel protocol.
 *
 * Identity strategy: pg's `client.query()` returns the raw `Query` object
 * when a callback is passed, and a Promise when no callback is passed
 * (the Promise path used by Drizzle ORM).  For callback calls we capture
 * the Query directly from the return value.  For Promise calls we peek at
 * the client's internal `_activeQuery` or `_queryQueue` right after the
 * call, which is where pg stores the just-created Query.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapClientQuery(client: Client, queryTimeoutMs: number): typeof client.query {
  const originalQuery = client.query.bind(client)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapped: any = (...args: any[]) => {
    const startedAt = Date.now()
    const first = args[0]
    const text = typeof first === 'string' ? first : first?.text

    // Detect callback-passing usage (last arg is a function).
    const cbIndex = args.findIndex((a: any) => typeof a === 'function')
    const hasCallback = cbIndex !== -1

    let timedOut = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedQuery: any = null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const captureQuery = (c: any): void => {
      // Peek at the client's internal state right after the call to find
      // the pg Query object that was just created.  This works for both
      // callback and Promise paths because pg synchronously pushes the
      // Query to _queryQueue (or sets it as _activeQuery) inside
      // client.query() before returning.
      capturedQuery = c._activeQuery ?? c._queryQueue?.[c._queryQueue.length - 1]
    }

    const scheduleTimeout = (): void => {
      if (queryTimeoutMs <= 0 || !capturedQuery) return
      timeoutId = setTimeout(() => {
        timedOut = true
        structuredLog('warn', 'query_timeout', { query: text, timeoutMs: queryTimeoutMs })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(client as any).cancel(client, capturedQuery)
      }, queryTimeoutMs)
    }

    const cleanup = (): void => {
      if (!timedOut && timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    if (hasCallback) {
      const originalCb = args[cbIndex]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrappedCb: typeof originalCb = (err: any, res: any) => {
        cleanup()
        const durationMs = Date.now() - startedAt
        if (!err && process.env.NODE_ENV === 'production' && durationMs > SLOW_QUERY_THRESHOLD_MS) {
          structuredLog('warn', 'slow_query', { query: text, durationMs })
        }
        originalCb(err, res)
      }
      const instrumentedArgs = [...args.slice(0, cbIndex), wrappedCb, ...args.slice(cbIndex + 1)]
      const result = (originalQuery as Function)(...instrumentedArgs)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      captureQuery(client as any)
      scheduleTimeout()
      return result
    }

    // Promise-based invocation.
    const result = (originalQuery as Function)(...args)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    captureQuery(client as any)
    scheduleTimeout()
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        cleanup()
        const durationMs = Date.now() - startedAt
        if (process.env.NODE_ENV === 'production' && durationMs > SLOW_QUERY_THRESHOLD_MS) {
          structuredLog('warn', 'slow_query', { query: text, durationMs })
        }
      })
    }
    return result
  }

  return wrapped
}

/**
 * Attach the slow-query logging and query-timeout guard to a pool. Registered
 * per-client via the pool's `connect` event.
 */
function attachClientQueryHooks(pool: Pool, queryTimeoutMs: number): void {
  if (process.env.NODE_ENV !== 'production' && queryTimeoutMs <= 0) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool.on('connect', (client: Client) => {
    client.query = wrapClientQuery(client, queryTimeoutMs)
  })
}

export function createDbPool(config: DbPoolConfig = {}): Pool {
  if (pool) return pool

  pool = new Pool({
    connectionString: buildConnectionString(config.databaseUrl, config),
    min: config.poolMin ?? (Number(process.env.DB_POOL_MIN) || 2),
    max: config.poolMax ?? (Number(process.env.DB_POOL_MAX) || 20),
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis:
      config.connectionTimeoutMillis ?? (Number(process.env.DB_CONNECTION_TIMEOUT) || 5_000),
  })

  pool.on('error', (err) => {
    structuredLog('error', 'pool_error', { message: err.message })
  })

  attachClientQueryHooks(pool, config.queryTimeout ?? DEFAULT_QUERY_TIMEOUT)

  return pool
}

export function getDbPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call createDbPool() first.')
  }
  return pool
}

export function createDbInstance(config: DbPoolConfig = {}, schema?: Record<string, unknown>) {
  const p = createDbPool(config)
  const logger = process.env.NODE_ENV !== 'production' // dev/non-prod logs all queries
  return drizzle(p, schema ? { schema, logger } : { logger })
}

export type DbInstance = ReturnType<typeof createDbInstance>

export interface HealthCheckResult {
  ok: boolean
  latencyMs: number
  poolStats: {
    totalCount: number
    idleCount: number
    waitingCount: number
  }
}

const HEALTH_CHECK_TIMEOUT_MS = 5_000

/**
 * Run a database health check that executes `SELECT 1` with a 5-second
 * timeout and returns connection status, latency, and pool statistics.
 *
 * Used by the NestJS health controller for liveness/readiness probes.
 * Never throws — returns `{ ok: false }` on any error or timeout.
 */
export async function dbHealth(): Promise<HealthCheckResult> {
  const startedAt = Date.now()

  let p: Pool
  try {
    p = getDbPool()
  } catch {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      poolStats: { totalCount: 0, idleCount: 0, waitingCount: 0 },
    }
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Health check query timed out')), HEALTH_CHECK_TIMEOUT_MS)
    })

    await Promise.race([p.query('SELECT 1'), timeout])

    const latencyMs = Date.now() - startedAt
    return {
      ok: true,
      latencyMs,
      poolStats: {
        totalCount: p.totalCount,
        idleCount: p.idleCount,
        waitingCount: p.waitingCount,
      },
    }
  } catch {
    const latencyMs = Date.now() - startedAt
    return {
      ok: false,
      latencyMs,
      poolStats: {
        totalCount: p.totalCount,
        idleCount: p.idleCount,
        waitingCount: p.waitingCount,
      },
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export * from 'drizzle-orm'
export * from './types'