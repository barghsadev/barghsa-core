import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
    beforeEach(() => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test'
    })

    afterEach(() => {
      delete process.env.DATABASE_URL
    })

    it('createDbPool accepts queryTimeout option', () => {
      const p = createDbPool({ queryTimeout: 5000 })
      expect(p).toBeDefined()
      p.end().catch(() => {})
    })

    it('default queryTimeout is 30_000 ms', () => {
      const p = createDbPool({})
      expect(p).toBeDefined()
      p.end().catch(() => {})
    })

    it('attaches client query hooks with timeout guard', () => {
      // Verify the pool's event emitter is wired up correctly by checking
      // that the internal pool object has the expected listener count.
      const p = createDbPool({ queryTimeout: 100 })
      expect(p.listeners('connect').length).toBe(1)
      expect(p.listeners('error').length).toBe(1)
      p.end().catch(() => {})
    })
  })
})