import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

let pool: Pool | null = null

export interface DbConfig {
  databaseUrl?: string
  poolMin?: number
  poolMax?: number
  idleTimeoutMillis?: number
  connectionTimeoutMillis?: number
}

export function createDbPool(config: DbConfig = {}): Pool {
  if (pool) return pool

  pool = new Pool({
    connectionString: config.databaseUrl ?? process.env.DATABASE_URL,
    min: config.poolMin ?? 2,
    max: config.poolMax ?? 20,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 5_000,
  })

  pool.on('error', (err) => {
    console.error('Unexpected pool error:', err.message)
  })

  // Apply session-level timeouts on new connections
  pool.on('connect', (client) => {
    client.query("SET statement_timeout = '10s'").catch(() => {})
    client.query("SET lock_timeout = '5s'").catch(() => {})
    client.query("SET idle_in_transaction_session_timeout = '60s'").catch(() => {})
  })

  return pool
}

export function getDbPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call createDbPool() first.')
  }
  return pool
}

export function createDbInstance(config: DbConfig = {}) {
  const p = createDbPool(config)
  return drizzle(p, { logger: process.env.NODE_ENV !== 'production' })
}

export type DbInstance = ReturnType<typeof createDbInstance>

export * from 'drizzle-orm'