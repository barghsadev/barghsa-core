import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

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
    console.error('Unexpected pool error:', err.message)
  })

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
  return drizzle(p, schema ? { schema, logger: process.env.NODE_ENV !== 'production' } : { logger: process.env.NODE_ENV !== 'production' })
}

export type DbInstance = ReturnType<typeof createDbInstance>

export * from 'drizzle-orm'