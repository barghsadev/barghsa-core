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
}

const DEFAULT_STATEMENT_TIMEOUT = '30s'
const DEFAULT_LOCK_TIMEOUT = '5s'
const DEFAULT_IDLE_TX_TIMEOUT = '60s'
const SLOW_QUERY_THRESHOLD_MS = 200

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
 * Wrap each pooled client's query so that in production we can measure
 * execution duration and emit a structured JSON warning for slow queries.
 * Supports both Promise and callback invocation patterns.
 */
function attachSlowQueryLogging(pool: Pool): void {
  if (process.env.NODE_ENV !== 'production') return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool.on('connect', (client: Client) => {
    const originalQuery = client.query.bind(client)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.query = ((...args: any[]) => {
      const startedAt = Date.now()
      const first = args[0]
      const text = typeof first === 'string' ? first : first?.text

      // Detect callback-passing usage (last arg is a function).
      const cbIndex = args.findIndex((a: any) => typeof a === 'function')
      const hasCallback = cbIndex !== -1

      if (hasCallback) {
        const originalCb = args[cbIndex]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wrappedCb: typeof originalCb = (err: any, res: any) => {
          const durationMs = Date.now() - startedAt
          if (!err && durationMs > SLOW_QUERY_THRESHOLD_MS) {
            structuredLog('warn', 'slow_query', { query: text, durationMs })
          }
          originalCb(err, res)
        }
        // Swap the callback with our wrapped version.
        const instrumentedArgs = [...args.slice(0, cbIndex), wrappedCb, ...args.slice(cbIndex + 1)]
        return (originalQuery as Function)(...instrumentedArgs)
      }

      // Promise-based invocation.
      const result = (originalQuery as Function)(...args)
      if (result && typeof result.then === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return result.then((rows: any) => {
          const durationMs = Date.now() - startedAt
          if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
            structuredLog('warn', 'slow_query', { query: text, durationMs })
          }
          return rows
        })
      }
      return result
    }) as typeof client.query
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

  attachSlowQueryLogging(pool)

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

export * from 'drizzle-orm'