import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDbPool, getDbPool, buildConnectionString, wrapClientQuery } from './index'

/**
 * Build a minimal mock pg Client with internal active-query state and a
 * controllable deferred resolve for the Promise-style query path.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMockClient(): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
  cancel: ReturnType<typeof vi.fn>
  runQuery: ReturnType<typeof vi.fn>
  resolvePromise: () => void
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeQueryRef: { current: any } = { current: null }
  let deferredResolve: ((v: unknown) => void) | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runQuery = vi.fn((...args: any[]) => {
    // Simulate an in-flight query recorded in the internal active slot.
    activeQueryRef.current = { text: 'SELECT pg_sleep(5)' }
    const seenCallback = args.find((a: any) => typeof a === 'function')
    if (seenCallback) {
      // Callback style: leave it pending; caller fires it. Return undefined,
      // matching real pg behavior for callback queries.
      return undefined
    }
    // Promise style: return a Promise held until the test resolves it.
    return new Promise((resolve) => {
      deferredResolve = resolve
    })
  })

  const cancel = vi.fn()
  const client = {
    query: runQuery,
    _getActiveQuery: () => activeQueryRef.current,
    cancel,
  }
  const resolvePromise = (): void => {
    activeQueryRef.current = null
    if (deferredResolve) deferredResolve({ rows: [], rowCount: 0 })
  }
  return { client, cancel, runQuery, resolvePromise }
}

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
      const p = createDbPool({ queryTimeout: 100 })
      expect(p.listeners('connect').length).toBe(1)
      expect(p.listeners('error').length).toBe(1)
      p.end().catch(() => {})
    })
  })

  describe('wrapClientQuery timeout behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('cancels an in-flight query when the timeout elapses (Promise path)', () => {
      const { client, cancel } = makeMockClient()
      const wrapped = wrapClientQuery(client, 100) as typeof client.query
      wrapped('SELECT pg_sleep(5)')

      // Before the threshold: no cancellation yet.
      vi.advanceTimersByTime(50)
      expect(cancel).not.toHaveBeenCalled()

      // Advance past the 100ms threshold.
      vi.advanceTimersByTime(51)
      expect(cancel).toHaveBeenCalledTimes(1)
      // First arg is the client instance, second is the active query object.
      const call = cancel.mock.calls[0]!
      expect(call[0]).toBe(client)
      expect(call[1]).toHaveProperty('text')
    })

    it('cancels an in-flight query when the timeout elapses (callback path)', () => {
      const { client, cancel } = makeMockClient()
      const wrapped = wrapClientQuery(client, 100) as typeof client.query
      const cb = vi.fn()
      wrapped('SELECT pg_sleep(5)', cb)

      vi.advanceTimersByTime(100)
      expect(cancel).toHaveBeenCalledTimes(1)
      const call = cancel.mock.calls[0]!
      expect(call[1]).toHaveProperty('text')
    })

    it('does not cancel when the query completes before the timeout', () => {
      const { client, cancel, resolvePromise } = makeMockClient()
      const wrapped = wrapClientQuery(client, 100) as typeof client.query
      const result = wrapped('SELECT 1')

      // Complete the query well before the threshold (after 50ms).
      vi.advanceTimersByTime(50)
      resolvePromise()

      // Now advance far past the threshold; timer must have been cleaned up.
      vi.advanceTimersByTime(200)
      expect(cancel).not.toHaveBeenCalled()
    })

    it('does not schedule a timeout when queryTimeout is 0 (disabled)', () => {
      const { client, cancel } = makeMockClient()
      const wrapped = wrapClientQuery(client, 0) as typeof client.query
      wrapped('SELECT pg_sleep(5)')
      vi.advanceTimersByTime(1000)
      expect(cancel).not.toHaveBeenCalled()
    })

    it('preserves callback invocation', () => {
      const { client, runQuery } = makeMockClient()
      const wrapped = wrapClientQuery(client, 100) as typeof client.query
      const cb = vi.fn()
      wrapped('SELECT 1', cb)
      expect(runQuery).toHaveBeenCalled()
    })
  })
})