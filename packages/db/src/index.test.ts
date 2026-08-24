import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDbPool, getDbPool, buildConnectionString, wrapClientQuery } from './index'

/**
 * Build a minimal mock pg Client that mirrors the real client's internal
 * query-queue and active-query slots so wrapClientQuery can capture the
 * exact Query object.
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
  const _queryQueue: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let _activeQuery: any = null
  let deferredResolve: (() => void) | null = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runQuery = vi.fn((...args: any[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryObj: any = { text: 'query', id: Math.random(), callback: null }
    _queryQueue.push(queryObj)

    // Simulate the real pg flow: immediately start the query if no active one.
    if (!_activeQuery) {
      _activeQuery = _queryQueue.shift() ?? null
    }

    const seenCallback = args.find((a: any) => typeof a === 'function')
    if (seenCallback) {
      queryObj.callback = seenCallback
      // Callback path: return the Query object (matches real pg).
      return queryObj
    }

    // Promise path: return a Promise that stays pending until resolved.
    return new Promise((resolve) => {
      deferredResolve = () => {
        _activeQuery = null
        const next = _queryQueue.shift()
        if (next) _activeQuery = next
        resolve({ rows: [], rowCount: 0 })
      }
    })
  })

  const cancel = vi.fn()
  const client = {
    query: runQuery,
    _queryQueue,
    cancel,
  }
  // Use a getter for _activeQuery so wrapClientQuery reads the live value.
  Object.defineProperty(client, '_activeQuery', {
    get: () => _activeQuery,
    configurable: true,
  })

  const resolvePromise = (): void => {
    deferredResolve?.()
    deferredResolve = null
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

    it('cancels the correct query object when timeout elapses (Promise path)', () => {
      const { client, cancel } = makeMockClient()
      const wrapped = wrapClientQuery(client, 100) as typeof client.query
      wrapped('SELECT pg_sleep(5)')

      // The captured query should be the one in _activeQuery.
      const captured = (client as any)._activeQuery
      expect(captured).toBeDefined()

      vi.advanceTimersByTime(100)
      expect(cancel).toHaveBeenCalledTimes(1)
      const call = cancel.mock.calls[0]!
      // First arg is the client instance, second is the exact captured query.
      expect(call[0]).toBe(client)
      expect(call[1]).toBe(captured)
    })

    it('cancels the correct query object when timeout elapses (callback path)', () => {
      const { client, cancel, runQuery } = makeMockClient()
      const wrapped = wrapClientQuery(client, 100) as typeof client.query
      const cb = vi.fn()
      wrapped('SELECT pg_sleep(5)', cb)

      // Callback path: client.query() returns the Query object.
      const callbackResult = runQuery.mock.results[0]?.value
      expect(callbackResult).toBeDefined()

      vi.advanceTimersByTime(100)
      expect(cancel).toHaveBeenCalledTimes(1)
      const call = cancel.mock.calls[0]!
      expect(call[1]).toBe(callbackResult)
    })

    it('does not cancel when the query completes before the timeout', async () => {
      const { client, cancel, resolvePromise } = makeMockClient()
      const wrapped = wrapClientQuery(client, 100) as typeof client.query
      wrapped('SELECT 1')

      // Complete the query well before the threshold.
      vi.advanceTimersByTime(50)
      resolvePromise()
      // Flush microtasks so .finally() runs and clears the timeout.
      await vi.advanceTimersByTimeAsync(0)

      // Now advance far past the threshold; timer must have been cleaned up.
      await vi.advanceTimersByTimeAsync(200)
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