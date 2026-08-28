import { describe, it, expect, vi } from 'vitest'
import {
  recordJobFailure,
  recordJobSuccess,
  DEFAULT_MAX_ATTEMPTS,
} from './job-recorder.js'

/** Fake pg-like pool; each `query` call resolves to `{ rows: [] }` unless set. */
function makePool() {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
  return { mockQuery, pool: { query: mockQuery } }
}

describe('job-recorder (T-09.09.02)', () => {
  it('inserts a fresh failure row when no active row exists', async () => {
    const { mockQuery, pool } = makePool()
    // SELECT finds nothing, then INSERT.
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await recordJobFailure({ jobType: 'service_breach_scan', error: 'boom' }, pool)

    const selectCall = mockQuery.mock.calls[0]!
    expect(String(selectCall[0])).toContain('FROM background_jobs')
    const insertCall = mockQuery.mock.calls[1]!
    expect(String(insertCall[0])).toContain('INSERT INTO background_jobs')
    // status 'failed' is a SQL literal; params are [jobType, error, category, maxAttempts, ...]
    expect(String(insertCall[0])).toContain("'failed'")
    expect(insertCall[1]![0]).toBe('service_breach_scan')
    expect(insertCall[1]![1]).toBe('boom') // sanitized error
    expect(insertCall[1]![2]).toBe('transient')
    expect(insertCall[1]![3]).toBe(5) // maxAttempts
  })

  it('increments attempts on an existing active row', async () => {
    const { mockQuery, pool } = makePool()
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'job-1', attempts: 2, status: 'failed' }],
    })
    await recordJobFailure({ jobType: 'service_breach_scan', error: 'boom again' }, pool)

    const updateCall = mockQuery.mock.calls[1]!
    expect(String(updateCall[0])).toContain('UPDATE background_jobs')
    expect(updateCall[1]![0]).toBe('job-1')
    expect(updateCall[1]![4]).toBe(3) // attempts+1
    expect(updateCall[1]![1]).toBe('failed')
  })

  it('dead-letters the row once attempts reach max_attempts', async () => {
    const { mockQuery, pool } = makePool()
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'job-1', attempts: 4, status: 'failed' }],
    })
    await recordJobFailure(
      { jobType: 'service_breach_scan', error: 'final', maxAttempts: 5 },
      pool,
    )

    const updateCall = mockQuery.mock.calls[1]!
    expect(updateCall[1]![1]).toBe('dead_letter')
    expect(updateCall[1]![4]).toBe(5)
    // No next_run_at when dead-lettered (param 8 is null).
    expect(updateCall[1]![8]).toBeNull()
  })

  it('sanitizes the persisted error message', async () => {
    const { mockQuery, pool } = makePool()
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await recordJobFailure(
      { jobType: 'service_breach_scan', error: 'provider threw: postgres://u:p@h/db' },
      pool,
    )
    const insertCall = mockQuery.mock.calls[1]!
    const persisted = String(insertCall[1]![2])
    expect(persisted).not.toContain('postgres://')
    expect(persisted).not.toContain('u:p')
  })

  it('never throws when the DB write fails (best-effort)', async () => {
    const { mockQuery } = makePool()
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    await expect(
      recordJobFailure({ jobType: 'service_breach_scan', error: 'x' }, { query: mockQuery }),
    ).resolves.toBeUndefined()
  })

  it('resolves an active row on success (auto-clear)', async () => {
    const { mockQuery, pool } = makePool()
    await recordJobSuccess('service_breach_scan', pool)

    const updateCall = mockQuery.mock.calls[0]!
    expect(String(updateCall[0])).toContain("status = 'resolved'")
    expect(updateCall[1]![0]).toBe('service_breach_scan')
  })

  it('exposes a sane default max attempts', () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(5)
  })
})
