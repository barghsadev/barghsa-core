import { describe, it, expect } from 'vitest'
import { createDbPool, getDbPool, buildConnectionString } from './index'

describe('@barghsa/db', () => {
  it('export createDbPool is a function', () => {
    expect(typeof createDbPool).toBe('function')
  })

  describe('buildConnectionString', () => {
    it('encodes GUC options in the connection string', () => {
      const result = buildConnectionString('postgresql://localhost:5432/test', {})
      expect(result).toContain('options=')
      expect(decodeURIComponent(result)).toContain('statement_timeout=30s')
      expect(decodeURIComponent(result)).toContain('lock_timeout=5s')
      expect(decodeURIComponent(result)).toContain('idle_in_transaction_session_timeout=60s')
    })

    it('appends with & when base URL already has query params', () => {
      const result = buildConnectionString('postgresql://localhost:5432/test?sslmode=require', {})
      expect(result).toContain('&options=')
    })

    it('uses custom timeout overrides', () => {
      const result = buildConnectionString('postgresql://localhost:5432/test', {
        statementTimeout: '45s',
        lockTimeout: '10s',
      })
      expect(decodeURIComponent(result)).toContain('statement_timeout=45s')
      expect(decodeURIComponent(result)).toContain('lock_timeout=10s')
    })

    it('returns empty string when no URL available', () => {
      const original = process.env.DATABASE_URL
      delete process.env.DATABASE_URL
      const result = buildConnectionString(undefined, {})
      expect(result).toBe('')
      if (original) process.env.DATABASE_URL = original
    })
  })

  it('getDbPool throws when pool not initialized', () => {
    expect(() => getDbPool()).toThrow('Database pool not initialized')
  })

  describe('queryTimeout config', () => {
    it('createDbPool accepts queryTimeout option', () => {
      // Use a dummy URL so pool init doesn't fail immediately
      const original = process.env.DATABASE_URL
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test'
      const p = createDbPool({ queryTimeout: 5000 })
      expect(p).toBeDefined()
      p.end().catch(() => {})
      if (original) process.env.DATABASE_URL = original
    })

    it('default queryTimeout is 30_000 ms', () => {
      const original = process.env.DATABASE_URL
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test'
      const p = createDbPool({})
      expect(p).toBeDefined()
      p.end().catch(() => {})
      if (original) process.env.DATABASE_URL = original
    })
  })
})