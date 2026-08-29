import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { UploadPolicyService as ServiceType } from './upload-policy.service.js'

/**
 * SQL-routing mock for @barghsa/db (same pattern as the VAT config
 * service tests): router.on(fragment, fn) dispatches by SQL content so
 * BEGIN/COMMIT and Promise.all reordering never break the queue.
 * Deployment limits come from the REAL upload.config.ts (deterministic
 * per category), so the deployment-bound assertions test actual values.
 */
function makeDb() {
  type Handler = (values: unknown[], callIndex: number) => { rows: unknown[]; rowCount?: number | null }
  const handlers = new Map<string, Handler>()
  const callCounts = new Map<string, number>()
  const calls: Array<{ sql: string; values: unknown[] }> = []

  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    for (const [frag, fn] of handlers) {
      if (sql.includes(frag)) {
        const idx = callCounts.get(frag) ?? 0
        callCounts.set(frag, idx + 1)
        return fn(values, idx)
      }
    }
    return { rows: [], rowCount: null }
  })

  const client = { query, release: vi.fn() }
  const pool = { query, connect: async () => client }

  const router = {
    on: (frag: string, fn: Handler) => handlers.set(frag, fn),
    calls,
    queries: (frag: string) => calls.filter((c) => c.sql.includes(frag)),
  }

  return { query, pool, router }
}

function policyRow(over: Record<string, unknown> = {}) {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    category: 'document',
    allowed_extensions: ['.pdf', '.docx'],
    max_size_bytes: 5 * 1024 * 1024,
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_until: null,
    created_by: 'user-admin-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

const ACTOR = 'user-admin-1'
const POLICY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

/** Load UploadPolicyService with a mocked @barghsa/db pool. */
async function loadService(pool: { query: ReturnType<typeof vi.fn> }) {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
  const { UploadPolicyService: Svc } = await import('./upload-policy.service.js')
  const correlationIdProvider = { getCorrelationId: () => 'corr-upload-policy-test-1' }
  return new Svc(correlationIdProvider as never) as ServiceType
}

function createInput(over: Record<string, unknown> = {}): import('./upload-policy.service.js').CreateUploadPolicyInput {
  return {
    category: 'document',
    allowedExtensions: ['.pdf', '.docx'],
    maxSizeBytes: 5 * 1024 * 1024,
    actorUserId: ACTOR,
    ip: '127.0.0.1',
    ...over,
  } as import('./upload-policy.service.js').CreateUploadPolicyInput
}

function endInput(over: Record<string, unknown> = {}) {
  return {
    id: POLICY_ID,
    actorUserId: ACTOR,
    ip: '127.0.0.1',
    ...over,
  }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('UploadPolicyService.list (T-09.12.05)', () => {
  it('returns policy DTOs mapped from rows, newest first', async () => {
    const { pool, router } = makeDb()
    router.on('ORDER BY effective_from DESC, created_at DESC', () => ({
      rows: [
        policyRow({ max_size_bytes: 2 * 1024 * 1024, allowed_extensions: ['.pdf'] }),
        policyRow({ effective_until: '2026-02-01T00:00:00.000Z', id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
      ],
    }))
    const service = await loadService(pool)

    const result = await service.list()

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      id: POLICY_ID,
      category: 'document',
      allowedExtensions: ['.pdf'],
      maxSizeBytes: 2 * 1024 * 1024,
      effectiveUntil: null,
      status: 'current',
    })
    expect(result[1]).toMatchObject({ status: 'expired' })
  })

  it('filters by category when given', async () => {
    const { pool, router } = makeDb()
    let filterValue: unknown = null
    router.on('WHERE category = $1', (values) => {
      filterValue = values[0]
      return { rows: [policyRow({ category: 'image' })] }
    })
    const service = await loadService(pool)

    await service.list('image')

    expect(filterValue).toBe('image')
  })

  it('rejects an unknown category with 400', async () => {
    const { pool } = makeDb()
    const service = await loadService(pool)
    const rejection = await service.list('contract').catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({ error: 'UPLOAD_POLICY_CATEGORY_INVALID' })
  })
})

describe('UploadPolicyService.create (T-09.12.05)', () => {
  it('inserts a policy, audits change_recorded, and returns the DTO', async () => {
    const { pool, router } = makeDb()
    router.on('AND effective_until IS NULL', () => ({ rows: [] })) // no open policy
    router.on('effective_from <= $2', () => ({ rows: [] })) // no overlap conflict
    router.on('INSERT INTO upload_policies', () => ({ rows: [], rowCount: 1 }))
    router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
    router.on('WHERE id = $1', () => ({ rows: [policyRow()] })) // read back
    const service = await loadService(pool)

    const result = await service.create(createInput())

    const inserts = router.queries('INSERT INTO upload_policies')
    expect(inserts).toHaveLength(1)
    const [sql, values] = [inserts[0]!.sql, inserts[0]!.values]
    expect(sql).toContain('INSERT INTO upload_policies')
    expect(values[1]).toBe('document')
    expect(values[2]).toEqual(['.pdf', '.docx'])
    expect(values[3]).toBe(5 * 1024 * 1024)

    const audit = router.queries('INSERT INTO audit_log')
    expect(audit).toHaveLength(1)
    const auditMeta = JSON.parse(audit[0]!.values[2] as string) as Record<string, unknown>
    expect(auditMeta).toMatchObject({
      entity: 'upload_policy',
      action: 'created',
      category: 'document',
      maxSizeBytes: 5 * 1024 * 1024,
    })
    expect(audit[0]!.values[3]).toBe('corr-upload-policy-test-1')

    expect(result).toMatchObject({
      id: POLICY_ID,
      category: 'document',
      allowedExtensions: ['.pdf', '.docx'],
      status: 'current',
    })
  })

  it('is a no-op (no insert, no audit) when the same policy is already open', async () => {
    const { pool, router } = makeDb()
    router.on('AND effective_until IS NULL', () => ({
      rows: [policyRow()], // open policy identical to the input
    }))
    router.on('WHERE id = $1', () => ({ rows: [policyRow()] }))
    const service = await loadService(pool)

    const result = await service.create(createInput())

    expect(router.queries('INSERT INTO upload_policies')).toHaveLength(0)
    expect(router.queries('INSERT INTO audit_log')).toHaveLength(0)
    expect(result.id).toBe(POLICY_ID)
  })

  it('closes the previously open policy at the new effective_from', async () => {
    const { pool, router } = makeDb()
    router.on('AND effective_until IS NULL', () => ({
      rows: [policyRow({ max_size_bytes: 4 * 1024 * 1024 })], // different size → change
    }))
    router.on('UPDATE upload_policies', () => ({ rows: [], rowCount: 1 }))
    router.on('INSERT INTO upload_policies', () => ({ rows: [], rowCount: 1 }))
    router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
    router.on('WHERE id = $1', () => ({ rows: [policyRow()] }))
    const service = await loadService(pool)

    await service.create(
      createInput({ effectiveFrom: '2026-02-01T00:00:00.000Z' }),
    )

    const updates = router.queries('UPDATE upload_policies')
    expect(updates).toHaveLength(1)
    // closes the OPEN policy (id at values[1]) at the new effectiveFrom (values[0])
    expect(updates[0]!.values[0]).toEqual(new Date('2026-02-01T00:00:00.000Z'))
    expect(updates[0]!.values[1]).toBe(POLICY_ID)

    const audit = router.queries('INSERT INTO audit_log')
    const auditMeta = JSON.parse(audit[0]!.values[2] as string) as Record<string, unknown>
    expect(auditMeta).toMatchObject({ action: 'created', closedUploadPolicyId: POLICY_ID })
  })

  it('rejects an effectiveFrom not strictly after the open policy start', async () => {
    const { pool, router } = makeDb()
    router.on('AND effective_until IS NULL', () => ({
      rows: [policyRow({ max_size_bytes: 4 * 1024 * 1024 })],
    }))
    const service = await loadService(pool)

    const rejection = await service
      .create(createInput({ effectiveFrom: '2025-12-01T00:00:00.000Z' }))
      .catch((e: unknown) => e)

    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({ error: 'UPLOAD_POLICY_INVALID_EFFECTIVE_FROM' })
    expect(router.queries('INSERT INTO upload_policies')).toHaveLength(0)
  })

  it('rejects an effectiveFrom inside an already-ended window (pre-check)', async () => {
    const { pool, router } = makeDb()
    router.on('AND effective_until IS NULL', () => ({ rows: [] }))
    router.on('effective_from <= $2', () => ({
      rows: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', effective_from: '2026-01-01T00:00:00.000Z', effective_until: '2026-03-01T00:00:00.000Z' }],
    }))
    const service = await loadService(pool)

    const rejection = await service
      .create(createInput({ effectiveFrom: '2026-02-01T00:00:00.000Z' }))
      .catch((e: unknown) => e)

    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({ error: 'UPLOAD_POLICY_INVALID_EFFECTIVE_FROM' })
  })

  it('rejects an unknown category with 400', async () => {
    const { pool } = makeDb()
    const service = await loadService(pool)
    const rejection = await service.create(createInput({ category: 'general' })).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({ error: 'UPLOAD_POLICY_CATEGORY_INVALID' })
  })

  it('rejects a whitelist whose tokens all normalize to nothing', async () => {
    const { pool } = makeDb()
    const service = await loadService(pool)
    const rejection = await service
      .create(createInput({ allowedExtensions: ['exe', 'no-dot', '', '..exe'] }))
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({ error: 'UPLOAD_POLICY_EXTENSIONS_INVALID' })
  })

  it('rejects extensions outside the deployment-permitted set (deployment boundary)', async () => {
    const { pool } = makeDb()
    const service = await loadService(pool)
    const rejection = await service
      .create(createInput({ allowedExtensions: ['.pdf', '.exe'] }))
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: 'UPLOAD_POLICY_EXTENSION_NOT_DEPLOYMENT_PERMITTED',
    })
  })

  it('rejects a max size above the deployment per-category cap (deployment boundary)', async () => {
    const { pool } = makeDb()
    const service = await loadService(pool)
    // document deployment cap = 10 MB
    const rejection = await service
      .create(createInput({ maxSizeBytes: 11 * 1024 * 1024 }))
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({ error: 'UPLOAD_POLICY_SIZE_INVALID' })
  })

  it('rejects a non-integer max size', async () => {
    const { pool } = makeDb()
    const service = await loadService(pool)
    const rejection = await service
      .create(createInput({ maxSizeBytes: 5.5 }))
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({ error: 'UPLOAD_POLICY_SIZE_INVALID' })
  })

  it('maps a DB window-overlap (23P01) race to a 409', async () => {
    const { pool, router } = makeDb()
    router.on('AND effective_until IS NULL', () => ({ rows: [] }))
    router.on('effective_from <= $2', () => ({ rows: [] }))
    router.on('INSERT INTO upload_policies', () => {
      const error = new Error('exclusion violation') as Error & { code: string }
      error.code = '23P01'
      throw error
    })
    const service = await loadService(pool)

    const rejection = await service.create(createInput()).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 409 })
    expect(rejectionBody(rejection)).toMatchObject({ error: 'UPLOAD_POLICY_WINDOW_OVERLAP' })
  })
})

describe('UploadPolicyService.end (T-09.12.05)', () => {
  it('soft-closes the open policy and audits', async () => {
    const { pool, router } = makeDb()
    router.on('WHERE id = $1', (_values, idx) => ({
      // idx 0: findPolicyById before the UPDATE (open); idx 1: read after (ended)
      rows: idx === 0
        ? [policyRow()]
        : [policyRow({ effective_until: '2026-08-28T12:00:00.000Z' })],
    }))
    router.on('UPDATE upload_policies', () => ({ rows: [], rowCount: 1 }))
    router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
    const service = await loadService(pool)

    const result = await service.end(endInput())

    const updates = router.queries('UPDATE upload_policies')
    expect(updates).toHaveLength(1)
    expect(updates[0]!.values[1]).toBe(POLICY_ID)
    const audit = router.queries('INSERT INTO audit_log')
    expect(audit).toHaveLength(1)
    const auditMeta = JSON.parse(audit[0]!.values[2] as string) as Record<string, unknown>
    expect(auditMeta).toMatchObject({ entity: 'upload_policy', action: 'ended' })
    expect(result).toMatchObject({ id: POLICY_ID, status: 'expired' })
  })

  it('is a no-op when the policy is already ended', async () => {
    const { pool, router } = makeDb()
    router.on('WHERE id = $1', () => ({
      rows: [policyRow({ effective_until: '2026-02-01T00:00:00.000Z' })],
    }))
    const service = await loadService(pool)

    const result = await service.end(endInput())

    expect(router.queries('UPDATE upload_policies')).toHaveLength(0)
    expect(router.queries('INSERT INTO audit_log')).toHaveLength(0)
    expect(result.effectiveUntil).toBe('2026-02-01T00:00:00.000Z')
  })

  it('rejects an effectiveUntil not strictly after the policy start', async () => {
    const { pool, router } = makeDb()
    router.on('WHERE id = $1', () => ({ rows: [policyRow()] }))
    const service = await loadService(pool)

    const rejection = await service
      .end(endInput({ effectiveUntil: '2025-12-01T00:00:00.000Z' }))
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({ error: 'UPLOAD_POLICY_INVALID_EFFECTIVE_UNTIL' })
  })

  it('404s for an unknown policy id', async () => {
    const { pool, router } = makeDb()
    router.on('WHERE id = $1', () => ({ rows: [] }))
    const service = await loadService(pool)

    const rejection = await service.end(endInput()).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 404 })
    expect(rejectionBody(rejection)).toMatchObject({ error: 'UPLOAD_POLICY_NOT_FOUND' })
  })
})
