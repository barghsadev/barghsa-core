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
  it('records a failure as a single atomic upsert (fresh/insert params)', async () => {
    const { mockQuery, pool } = makePool()
    await recordJobFailure({ jobType: 'service_breach_scan', error: 'boom' }, pool)

    // Exactly one statement — no separate SELECT-then-write.
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const sql = String(mockQuery.mock.calls[0]![0])
    expect(sql).toContain('INSERT INTO background_jobs')
    expect(sql).toContain(
      "ON CONFLICT (job_type) WHERE status IN ('failed', 'retrying', 'dead_letter')",
    )
    expect(sql).toContain('DO UPDATE SET')

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    // [jobType, safeError, category, maxAttempts, payload, now, nextRunAt]
    expect(params[0]).toBe('service_breach_scan')
    expect(params[1]).toBe('boom')
    expect(params[2]).toBe('transient')
    expect(params[3]).toBe(DEFAULT_MAX_ATTEMPTS)
  })

  it('increments attempts inside the upsert DO UPDATE (no lost increments)', async () => {
    const { mockQuery, pool } = makePool()
    await recordJobFailure({ jobType: 'service_breach_scan', error: 'boom again' }, pool)

    const sql = String(mockQuery.mock.calls[0]![0])
    expect(sql).toContain('attempts = background_jobs.attempts + 1')
    // No standalone UPDATE statement anywhere in the failure path.
    expect(sql).not.toMatch(/^\s*UPDATE background_jobs/m)
  })

  it('dead-letters in the upsert once attempts + 1 reach max_attempts', async () => {
    const { mockQuery, pool } = makePool()
    await recordJobFailure(
      { jobType: 'service_breach_scan', error: 'final', maxAttempts: 5 },
      pool,
    )

    const sql = String(mockQuery.mock.calls[0]![0])
    expect(sql).toMatch(
      /WHEN background_jobs\.attempts \+ 1 >= EXCLUDED\.max_attempts\s+THEN 'dead_letter'/,
    )
    // Clear next_run_at when dead-lettered.
    expect(sql).toMatch(
      /WHEN background_jobs\.attempts \+ 1 >= EXCLUDED\.max_attempts\s+THEN NULL/,
    )
  })

  it('returns a non-exhausted row to `failed` so it stays under the Failed filter', async () => {
    const { mockQuery, pool } = makePool()
    await recordJobFailure({ jobType: 'service_breach_scan', error: 'again' }, pool)

    const sql = String(mockQuery.mock.calls[0]![0])
    // The ELSE branch reverts retrying -> failed when not yet exhausted.
    expect(sql).toMatch(/THEN 'dead_letter'\s+ELSE 'failed'\s+END/)
  })

  it('sanitizes the persisted error message (asserts on the real param, index 1)', async () => {
    const { mockQuery, pool } = makePool()
    await recordJobFailure(
      { jobType: 'service_breach_scan', error: 'provider threw: postgres://alice:s3cret@db.internal:5432/main' },
      pool,
    )
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    const persisted = String(params[1]) // the sanitized message
    expect(persisted).not.toContain('s3cret')
    expect(persisted).not.toContain('alice:s3cret')
    expect(persisted).toContain('[REDACTED]')
    expect(persisted).toContain('postgres://') // scheme itself is retained (secrets redacted)
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

    const sql = String(mockQuery.mock.calls[0]![0])
    expect(sql).toContain("status = 'resolved'")
    expect(mockQuery.mock.calls[0]![1]![0]).toBe('service_breach_scan')
  })

  it('exposes a sane default max attempts', () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(5)
  })
})
