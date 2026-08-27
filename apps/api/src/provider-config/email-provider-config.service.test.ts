import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  EmailProviderConfigService,
  type EmailProviderConfigResult,
  type ProviderPool,
} from './email-provider-config.service'

/**
 * In-memory mock of the `email_provider_configs` table keyed by id, plus a
 * query-log for asserting transaction boundaries (BEGIN/COMMIT/ROLLBACK).
 */
function buildHarness() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = new Map<string, any>()
  const queries: string[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exec = async (text: string, params?: unknown[]): Promise<any> => {
    queries.push(text)
    const lower = text.toLowerCase()

    // Transaction control
    if (lower.startsWith('begin')) return { rows: [] }
    if (lower.startsWith('commit')) return { rows: [] }
    if (lower.startsWith('rollback')) return { rows: [] }

    const idParam = (): string => String(params![0])

    // INSERT (new draft): params = [id, transport, label, config, createdBy, supersedesId]
    if (lower.includes('insert into email_provider_configs')) {
      const id = idParam()
      rows.set(id, {
        id,
        transport: params![1],
        label: params![2],
        status: 'draft',
        config: params![3],
        created_by: params![4],
        supersedes_id: params![5] ?? null,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
        activated_at: null,
        last_test_at: null,
        last_test_status: 'pending',
        last_test_error: null,
      })
      return { rows: [], rowCount: 1 }
    }

    // Demote current active -> superseded (RETURNING id)
    if (lower.includes('returning id') && lower.includes(`status = 'active'`)) {
      const active = [...rows.values()].filter((r) => r.status === 'active')
      for (const r of active) r.status = 'superseded'
      return { rows: active.map((r) => ({ id: r.id })) }
    }

    // Activate query inside a transaction:
    // UPDATE ... SET status='active', activated_at=NOW(), supersedes_id=$2 WHERE id=$1 [AND status='draft']
    if (lower.includes('set status = \'active\'') && lower.includes('supersedes_id = $2')) {
      const targetId = idParam()
      const supersedesId = params![1] ?? null
      const r = rows.get(targetId)
      if (r) {
        r.status = 'active'
        r.activated_at = new Date('2026-01-01T00:00:00Z')
        r.supersedes_id = supersedesId
      }
      return { rows: [], rowCount: r ? 1 : 0 }
    }

    // Count active (disable guard)
    if (lower.includes('where status = \'active\'') && lower.includes('count(*)')) {
      const n = [...rows.values()].filter((r) => r.status === 'active').length
      return { rows: [{ n: String(n) }] }
    }

    // Count recovery versions (superseded/disabled) for the disable guard
    if (lower.includes('status in') && lower.includes('count(*)')) {
      const n = [...rows.values()].filter(
        (r) => r.id !== idParam() && (r.status === 'superseded' || r.status === 'disabled'),
      ).length
      return { rows: [{ n: String(n) }] }
    }

    // Generic status flip (disable / supersede / rollback mark):
    // UPDATE ... SET status=$1 ... WHERE id=$2   OR   SET status='disabled' WHERE id=$1
    if (lower.includes('update email_provider_configs') && lower.includes('set status')) {
      // Capture the status literal from the SQL if one is present; otherwise it
      // is the leading $1 parameter.
      const statusMatch = text.match(/set status\s*=\s*'([a-z_]+)'/i)
      const status = statusMatch ? statusMatch[1] : String(params![0])
      const targetId = String(params![params!.length - 1])
      const r = rows.get(targetId)
      if (r) r.status = status
      return { rows: [], rowCount: r ? 1 : 0 }
    }

    // Record test result (must run BEFORE generic status-flip / activate checks)
    if (lower.includes('update email_provider_configs') && lower.includes('set last_test')) {
      const testStatus = String(params![0])
      const testError = (params![1] as string | null) ?? null
      const targetId = String(params![2])
      const r = rows.get(targetId)
      if (r) {
        r.last_test_status = testStatus
        r.last_test_error = testError
        r.last_test_at = new Date('2026-01-01T00:00:00Z')
      }
      return { rows: [], rowCount: r ? 1 : 0 }
    }

    // Edit draft (label / config)
    if (lower.startsWith('update email_provider_configs set') && lower.includes('where id =')) {
      const targetId = String(params![params!.length - 1])
      const r = rows.get(targetId)
      if (r) {
        if (text.includes('label')) {
          r.label = params![0]
        }
        if (text.includes('config')) {
          r.config = params![1] ?? r.config
        }
      }
      return { rows: [], rowCount: r ? 1 : 0 }
    }

    // Read config blob (rollback path)
    if (lower.includes('select config from email_provider_configs')) {
      const r = rows.get(idParam())
      return { rows: r ? [{ config: r.config }] : [] }
    }

    // SELECT ... WHERE id = $1 -> single result
    if (lower.includes('from email_provider_configs where id =')) {
      const r = rows.get(idParam())
      const shape = r ? toResult(r) : undefined
      return { rows: shape ? [shape] : [] }
    }

    // SELECT ... ORDER BY created_at DESC (list)
    if (lower.includes('order by created_at desc')) {
      return { rows: [...rows.values()].map(toResult) }
    }

    return { rows: [] }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function toResult(r: any): EmailProviderConfigResult {
    return {
      id: r.id,
      transport: r.transport,
      label: r.label,
      status: r.status,
      createdBy: r.created_by,
      activatedAt: r.activated_at,
      lastTestAt: r.last_test_at,
      lastTestStatus: r.last_test_status,
      lastTestError: r.last_test_error,
      supersedesId: r.supersedes_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  }

  const pool: ProviderPool = {
    query: (text: string, params?: unknown[]) => exec(text, params),
    connect: async () => ({
      query: (text: string, params?: unknown[]) => exec(text, params),
      release: () => {
        /* noop */
      },
    }),
  } as unknown as ProviderPool

  const service = new EmailProviderConfigService(pool as never)

  return { service, pool, rows, queries }
}

describe('EmailProviderConfigService lifecycle (T-05.06.01)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a new draft with status draft', async () => {
    const { service } = buildHarness()
    const created = await service.create({
      transport: 'smtp',
      label: 'Primary SMTP',
      config: { host: 'example.com' },
      createdBy: 'admin-1',
    })
    expect(created.status).toBe('draft')
    expect(created.transport).toBe('smtp')
    expect(created.label).toBe('Primary SMTP')
    expect(created.lastTestStatus).toBe('pending')
  })

  it('cannot activate a draft before it has passed a test', async () => {
    const { service } = buildHarness()
    const created = await service.create({
      transport: 'resend',
      label: 'Resend',
      config: {},
      createdBy: 'admin-1',
    })
    await expect(service.activate(created.id)).rejects.toMatchObject({ status: 409 })
  })

  it('records a passing test then activates', async () => {
    const { service } = buildHarness()
    const created = await service.create({
      transport: 'resend',
      label: 'Resend',
      config: {},
      createdBy: 'admin-1',
    })
    const tested = await service.recordTest(created.id, { passed: true })
    expect(tested.lastTestStatus).toBe('passed')

    const active = await service.activate(created.id)
    expect(active.status).toBe('active')
    expect(active.activatedAt).not.toBeNull()
  })

  it('records a failing test and keeps the config in draft', async () => {
    const { service } = buildHarness()
    const created = await service.create({
      transport: 'resend',
      label: 'Resend',
      config: {},
      createdBy: 'admin-1',
    })
    const tested = await service.recordTest(created.id, {
      passed: false,
      error: 'Auth failed',
    })
    expect(tested.lastTestStatus).toBe('failed')
    expect(tested.lastTestError).toBe('Auth failed')
    expect(tested.status).toBe('draft')
  })

  it('only allows one active config at a time', async () => {
    const { service, rows } = buildHarness()
    const a = await service.create({ transport: 'resend', label: 'A', config: {}, createdBy: 'a' })
    await service.recordTest(a.id, { passed: true })
    await service.activate(a.id)

    const b = await service.create({ transport: 'resend', label: 'B', config: {}, createdBy: 'a' })
    await service.recordTest(b.id, { passed: true })
    const active = await service.activate(b.id)

    expect(active.status).toBe('active')
    const statuses = [...rows.values()].map((r) => r.status)
    expect(statuses.filter((s) => s === 'active')).toHaveLength(1)
  })

  it('supersedes the previous active and records supersedes_id', async () => {
    const { service, rows } = buildHarness()
    const a = await service.create({ transport: 'resend', label: 'A', config: {}, createdBy: 'a' })
    await service.recordTest(a.id, { passed: true })
    await service.activate(a.id)

    const b = await service.create({ transport: 'resend', label: 'B', config: {}, createdBy: 'a' })
    await service.recordTest(b.id, { passed: true })
    const active = await service.activate(b.id)

    expect(active.supersedesId).toBe(a.id)
    expect(rows.get(a.id).status).toBe('superseded')
  })

  it('blocks re-activation of a superseded (non-draft) config', async () => {
    const { service } = buildHarness()
    const a = await service.create({ transport: 'resend', label: 'A', config: {}, createdBy: 'a' })
    await service.recordTest(a.id, { passed: true })
    await service.activate(a.id)

    const b = await service.create({ transport: 'smtp', label: 'B', config: {}, createdBy: 'a' })
    await service.recordTest(b.id, { passed: true })
    await service.activate(b.id)
    // a is superseded now
    await expect(service.activate(a.id)).rejects.toMatchObject({ status: 409 })
  })

  it('blocks disabling the sole active provider (OTP recovery)', async () => {
    const { service } = buildHarness()
    const a = await service.create({ transport: 'smtp', label: 'A', config: {}, createdBy: 'a' })
    await service.recordTest(a.id, { passed: true })
    await service.activate(a.id)
    await expect(service.disable(a.id)).rejects.toMatchObject({
      status: 409,
      response: { message: expect.stringContaining('OTP') },
    })
  })

  it('allows disabling when another provider can cover the channel', async () => {
    const { service } = buildHarness()
    const a = await service.create({ transport: 'smtp', label: 'A', config: {}, createdBy: 'a' })
    await service.recordTest(a.id, { passed: true })
    await service.activate(a.id)
    const b = await service.create({ transport: 'resend', label: 'B', config: {}, createdBy: 'a' })
    await service.recordTest(b.id, { passed: true })
    const activeB = await service.activate(b.id)
    // b is active, a is superseded. Disabling b leaves a (superseded) — allowed.
    const disabled = await service.disable(activeB.id)
    expect(disabled.status).toBe('disabled')
  })

  it('rolls back to a superseded version', async () => {
    const { service, rows } = buildHarness()
    const a = await service.create({
      transport: 'smtp',
      label: 'Old SMTP',
      config: { host: 'old' },
      createdBy: 'a',
    })
    await service.recordTest(a.id, { passed: true })
    await service.activate(a.id)

    const b = await service.create({
      transport: 'smtp',
      label: 'New SMTP',
      config: { host: 'new' },
      createdBy: 'a',
    })
    await service.recordTest(b.id, { passed: true })
    await service.activate(b.id)
    // a is superseded
    const rolled = await service.rollback(a.id, 'admin-1')
    expect(rolled.status).toBe('active')
    expect(rolled.label).toContain('rollback')
    const actives = [...rows.values()].filter((r) => r.status === 'active')
    expect(actives).toHaveLength(1)
  })

  it('commits a transaction on activation', async () => {
    const { service, queries } = buildHarness()
    const a = await service.create({ transport: 'smtp', label: 'A', config: {}, createdBy: 'a' })
    await service.recordTest(a.id, { passed: true })
    await service.activate(a.id)
    expect(queries).toContain('BEGIN')
    expect(queries).toContain('COMMIT')
  })
})

describe('EmailProviderConfigService.testConnection (T-05.06.02)', () => {
  // engine-less fake; the real SMTP handshake lives in SmtpConnectionTesterService.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fakeTester = (outcome: { ok: boolean; error?: string }) =>
    ({ test: async () => outcome }) as never

  it('runs the tester and records a passing test for a valid smtp draft', async () => {
    const { service, rows } = buildHarness()
    const created = await service.create({
      transport: 'smtp',
      label: 'SMTP',
      config: { host: 'smtp.example.com', from_email: 'noreply@example.com' },
      createdBy: 'admin-1',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(service as any).smtpTester = fakeTester({ ok: true })
    const out = await service.testConnection(created.id)
    expect(out.ok).toBe(true)
    expect(out.result.lastTestStatus).toBe('passed')
    expect(rows.get(created.id).last_test_status).toBe('passed')
  })

  it('records a failing test with the tester error message', async () => {
    const { service, rows } = buildHarness()
    const created = await service.create({
      transport: 'smtp',
      label: 'SMTP',
      config: { host: 'smtp.example.com', from_email: 'noreply@example.com' },
      createdBy: 'admin-1',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(service as any).smtpTester = fakeTester({ ok: false, error: 'Connection refused' })
    const out = await service.testConnection(created.id)
    expect(out.ok).toBe(false)
    expect(out.error).toBe('Connection refused')
    expect(out.result.lastTestStatus).toBe('failed')
  })

  it('rejects a test when recipient is missing for resend (400)', async () => {
    const { service } = buildHarness()
    const created = await service.create({
      transport: 'resend',
      label: 'R',
      config: {},
      createdBy: 'admin-1',
    })
    await expect(service.testConnection(created.id)).rejects.toMatchObject({ status: 400 })
  })

  it('validates an invalid recipient email for resend (400)', async () => {
    const { service } = buildHarness()
    const created = await service.create({
      transport: 'resend',
      label: 'R',
      config: {},
      createdBy: 'admin-1',
    })
    await expect(service.testConnection(created.id, 'not-an-email')).rejects.toMatchObject({
      status: 400,
    })
  })

  it('rejects an unsupported transport with 400', async () => {
    const { service, rows } = buildHarness()
    const created = await service.create({
      transport: 'smtp',
      label: 'S',
      config: {},
      createdBy: 'admin-1',
    })
    // Force an unknown transport by patching the stored row directly.
    rows.get(created.id)!.transport = 'carrier'
    await expect(service.testConnection(created.id)).rejects.toMatchObject({ status: 400 })
  })

  it('records a validation failure when resend config is invalid', async () => {
    const { service } = buildHarness()
    // Missing required api_key + from_email.
    const created = await service.create({
      transport: 'resend',
      label: 'R',
      config: {},
      createdBy: 'admin-1',
    })
    const out = await service.testConnection(created.id, 'admin@example.com')
    expect(out.ok).toBe(false)
    expect(out.error).toContain('Invalid Resend configuration')
    expect(out.result.lastTestStatus).toBe('failed')
  })

  it('records a validation failure when config is invalid', async () => {
    const { service } = buildHarness()
    // Missing required host + from_email -> schema failure.
    const created = await service.create({
      transport: 'smtp',
      label: 'SMTP',
      config: { port: 587 },
      createdBy: 'admin-1',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(service as any).smtpTester = fakeTester({ ok: false, error: 'unused' })
    const out = await service.testConnection(created.id)
    expect(out.ok).toBe(false)
    expect(out.error).toContain('Invalid SMTP configuration')
    expect(out.result.lastTestStatus).toBe('failed')
  })
})
