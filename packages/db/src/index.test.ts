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
      expect(decodeURIComponent(result)).toContain('statement_timeout=10s')
      expect(decodeURIComponent(result)).toContain('lock_timeout=5s')
      expect(decodeURIComponent(result)).toContain('idle_in_transaction_session_timeout=60s')
    })

    it('appends with & when base URL already has query params', () => {
      const result = buildConnectionString('postgresql://localhost:5432/test?sslmode=require', {})
      expect(result).toContain('&options=')
    })

    it('uses custom timeout overrides', () => {
      const result = buildConnectionString('postgresql://localhost:5432/test', {
        statementTimeout: '30s',
        lockTimeout: '10s',
      })
      expect(decodeURIComponent(result)).toContain('statement_timeout=30s')
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
})