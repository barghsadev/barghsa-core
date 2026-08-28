import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { UploadPolicyResolver as ResolverType } from './upload-policy.resolver.js'
import type { EffectiveUploadPolicy } from './upload-policy.resolver.js'

function makeDb() {
  type Handler = (values: unknown[]) => { rows: unknown[]; rowCount?: number | null }
  const handlers = new Map<string, Handler>()
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    for (const [frag, fn] of handlers) {
      if (sql.includes(frag)) {
        return fn(values)
      }
    }
    return { rows: [], rowCount: null }
  })
  const pool = { query, connect: async () => ({ query, release: vi.fn() }) }
  const router = {
    on: (frag: string, fn: Handler) => handlers.set(frag, fn),
  }
  return { pool, router }
}

async function loadResolver(pool: { query: ReturnType<typeof vi.fn> }): Promise<ResolverType> {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
  const mod = await import('./upload-policy.resolver.js')
  return new mod.UploadPolicyResolver()
}

function dbPolicyRow(over: Record<string, unknown> = {}) {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    allowed_extensions: ['.pdf', '.docx'],
    max_size_bytes: 5 * 1024 * 1024,
    ...over,
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('UploadPolicyResolver.resolveEffective (T-09.12.05)', () => {
  it('returns the deployment baseline when no DB policy is active', async () => {
    const { pool, router } = makeDb()
    router.on('FROM upload_policies', () => ({ rows: [] }))
    const resolver = await loadResolver(pool)

    const policy = await resolver.resolveEffective('document')

    expect(policy).toMatchObject({
      allowedExtensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'],
      maxSizeBytes: 10 * 1024 * 1024,
      source: 'deployment',
      policyId: null,
    })
    expect(policy.allowedMimeTypes).toEqual([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'text/csv',
    ])
  })

  it('applies the DB policy bounded by the deployment caps', async () => {
    const { pool, router } = makeDb()
    router.on('FROM upload_policies', () => ({
      rows: [dbPolicyRow({ allowed_extensions: ['.pdf', '.docx'], max_size_bytes: 5 * 1024 * 1024 })],
    }))
    const resolver = await loadResolver(pool)

    const policy = await resolver.resolveEffective('document')

    expect(policy).toMatchObject({
      allowedExtensions: ['.pdf', '.docx'],
      maxSizeBytes: 5 * 1024 * 1024,
      source: 'db',
      policyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })
    // MIME set is always the deployment set, never widened by DB
    expect(policy.allowedMimeTypes).toContain('application/pdf')
    expect(policy.allowedMimeTypes).not.toContain('video/mp4')
  })

  it('intersects the DB whitelist with the deployment extension set (defense in depth)', async () => {
    const { pool, router } = makeDb()
    // A direct-DB write trying to widen beyond deployment: '.exe' is NOT
    // in the document deployment set → dropped at resolution time.
    router.on('FROM upload_policies', () => ({
      rows: [dbPolicyRow({ allowed_extensions: ['.exe', '.pdf'] })],
    }))
    const resolver = await loadResolver(pool)

    const policy = await resolver.resolveEffective('document')

    expect(policy.allowedExtensions).toEqual(['.pdf'])
  })

  it('fails closed (empty whitelist) when the DB policy intersects to nothing', async () => {
    const { pool, router } = makeDb()
    router.on('FROM upload_policies', () => ({
      rows: [dbPolicyRow({ allowed_extensions: ['.exe'] })],
    }))
    const resolver = await loadResolver(pool)

    const policy = await resolver.resolveEffective('document')

    expect(policy.allowedExtensions).toEqual([])
  })

  it('caps the effective size at min(DB, deployment)', async () => {
    const { pool, router } = makeDb()
    // DB says 50 MB but the document deployment cap is 10 MB
    router.on('FROM upload_policies', () => ({
      rows: [dbPolicyRow({ max_size_bytes: 50 * 1024 * 1024 })],
    }))
    const resolver = await loadResolver(pool)

    const policy = await resolver.resolveEffective('document')

    expect(policy.maxSizeBytes).toBe(10 * 1024 * 1024)
  })

  it('falls back to the deployment baseline on a DB outage (fail-open-to-baseline)', async () => {
    const { pool, router } = makeDb()
    router.on('FROM upload_policies', () => {
      throw new Error('connection refused')
    })
    const resolver = await loadResolver(pool)

    const policy = await resolver.resolveEffective('document')

    expect(policy).toMatchObject({
      source: 'deployment',
      policyId: null,
      maxSizeBytes: 10 * 1024 * 1024,
    })
    expect(policy.allowedExtensions).toContain('.pdf')
  })

  it('resolves non-admin categories (contract/general) to the deployment baseline', async () => {
    const { pool, router } = makeDb()
    router.on('FROM upload_policies', () => ({ rows: [] }))
    const resolver = await loadResolver(pool)

    const general = await resolver.resolveEffective('general')
    expect(general.allowedExtensions).toBeNull() // "any extension"
    expect(general.allowedMimeTypes).toContain('application/zip')

    const contract = await resolver.resolveEffective('contract')
    expect(contract).toMatchObject({ source: 'deployment', policyId: null })
    expect(contract.allowedMimeTypes).toContain('application/pdf')
  })
})

describe('effective policy check helpers (T-09.12.05)', () => {
  let helpers: {
    effectiveAllowsExtension: (policy: EffectiveUploadPolicy, fileName: string) => boolean
    effectiveAllowsMime: (policy: EffectiveUploadPolicy, contentType: string) => boolean
    effectiveAllowsSize: (policy: EffectiveUploadPolicy, fileSize: number) => boolean
  }

  beforeAll(async () => {
    vi.doMock('@barghsa/db', () => ({
      getDbPool: () => ({ query: vi.fn(), connect: async () => ({ query: vi.fn(), release: vi.fn() }) }),
    }))
    const mod = await import('./upload-policy.resolver.js')
    helpers = mod
  })

  const policy: EffectiveUploadPolicy = {
    allowedExtensions: ['.pdf', '.docx'],
    allowedMimeTypes: ['application/pdf', 'text/plain'],
    maxSizeBytes: 10 * 1024 * 1024,
    source: 'db',
    policyId: 'p1',
  }

  it('effectiveAllowsExtension matches lowercase dotted extensions', () => {
    expect(helpers.effectiveAllowsExtension(policy, 'report.pdf')).toBe(true)
    expect(helpers.effectiveAllowsExtension(policy, 'draft.DOCX')).toBe(true)
    expect(helpers.effectiveAllowsExtension(policy, 'malware.exe')).toBe(false)
    expect(helpers.effectiveAllowsExtension(policy, 'noext')).toBe(false)
  })

  it('effectiveAllowsExtension: null means any, empty means none', () => {
    expect(helpers.effectiveAllowsExtension({ ...policy, allowedExtensions: null }, 'x.exe')).toBe(true)
    expect(helpers.effectiveAllowsExtension({ ...policy, allowedExtensions: [] }, 'x.pdf')).toBe(false)
  })

  it('effectiveAllowsMime checks membership', () => {
    expect(helpers.effectiveAllowsMime(policy, 'application/pdf')).toBe(true)
    expect(helpers.effectiveAllowsMime(policy, 'video/mp4')).toBe(false)
  })

  it('effectiveAllowsSize checks the effective limit', () => {
    expect(helpers.effectiveAllowsSize(policy, 1024)).toBe(true)
    expect(helpers.effectiveAllowsSize(policy, 10 * 1024 * 1024)).toBe(true)
    expect(helpers.effectiveAllowsSize(policy, 10 * 1024 * 1024 + 1)).toBe(false)
  })
})