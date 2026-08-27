import { describe, it, expect, beforeEach } from 'vitest'
import { HttpException } from '@nestjs/common'
import {
  SmsProviderConfigService,
  type SmsProviderConfigResult,
  type ProviderConfigBody,
} from './sms-provider-config.service'
import { ProviderSecretsService } from './provider-secrets.service'

/**
 * In-memory mock of the `sms_provider_configs` table keyed by id, plus a
 * query-log for asserting transaction boundaries (BEGIN/COMMIT/ROLLBACK).
 */
function buildHarness() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = new Map<string, any>()
  const queries: string[] = []
  // Simulated active notification templates (event keys available for mapping).
  const activeTemplateEvents = new Set(['otp:login', 'invoice:created'])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exec = async (text: string, params?: unknown[]): Promise<any> => {
    queries.push(text)
    const lower = text.toLowerCase()

    if (lower.startsWith('begin')) return { rows: [] }
    if (lower.startsWith('commit')) return { rows: [] }
    if (lower.startsWith('rollback')) return { rows: [] }

    const idParam = (): string => String(params![0])

    // SELECT DISTINCT event_key ... from notification_templates
    if (lower.includes('from notification_templates') && lower.includes('distinct')) {
      return { rows: [...activeTemplateEvents].map((event_key) => ({ event_key })) }
    }

    // INSERT (new draft): params = [id, transport, label, config, createdBy, supersedesId]
    if (lower.includes('insert into sms_provider_configs')) {
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
        activated_by: null,
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

    // Activate query inside a transaction
    if (lower.includes('set status = \'active\'') && lower.includes('supersedes_id')) {
      const targetId = idParam()
      const supersedesId = params![1] ?? null
      const activatedBy = params![2] ?? null
      const r = rows.get(targetId)
      if (r) {
        r.status = 'active'
        r.activated_at = new Date('2026-01-01T00:00:00Z')
        r.activated_by = activatedBy
        r.supersedes_id = supersedesId
      }
      return { rows: [{ id: targetId }] }
    }

    // recordTest: UPDATE ... SET last_test_status = $1, last_test_error = $2 ...
    // params: [testStatus, error, id]
    if (lower.includes('set last_test_status')) {
      const r = rows.get(String(params![2] as string))
      if (r) {
        r.last_test_status = params![0]
        r.last_test_error = params![1] ?? null
        r.last_test_at = new Date('2026-01-01T00:00:00Z')
      }
      return { rows: [] }
    }

    // UPDATE generic (disable / label / config merge)
    if (lower.startsWith('update sms_provider_configs')) {
      // disable
      if (lower.includes(`status = 'disabled'`)) {
        const r = rows.get(idParam())
        if (r) r.status = 'disabled'
        return { rows: [] }
      }
      // draft-only edit (label=$, config=$, ... WHERE id=$n AND status='draft')
      const r = rows.get(String(params![params!.length - 1] as string))
      if (r) {
        if (lower.includes('label = ')) r.label = params![0]
        if (lower.includes('config = ')) {
          const patch = params![lower.includes('label = ') ? 1 : 0]
          r.config = { ...r.config, ...(patch ?? {}) }
        }
      }
      return { rows: [] }
    }

    // SELECT ... FROM sms_provider_configs WHERE id = $1  (get / findById / readConfig)
    if (lower.includes('select') && lower.includes('from sms_provider_configs')) {
      const r = rows.get(idParam())
      if (!r) return { rows: [] }
      // findById returns the full row (config column included)
      return { rows: [{ ...toResult(r) }] }
    }

    return { rows: [] }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function toResult(r: any): SmsProviderConfigResult & { config?: ProviderConfigBody } {
    return {
      id: r.id,
      transport: r.transport,
      label: r.label,
      status: r.status,
      createdBy: r.created_by,
      activatedAt: r.activated_at,
      activatedBy: r.activated_by ?? null,
      lastTestAt: r.last_test_at,
      lastTestStatus: r.last_test_status,
      lastTestError: r.last_test_error,
      supersedesId: r.supersedes_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      // Raw config is included so the service's maskRow() can build the
      // masked view; it is stripped before the API returns the row.
      config: r.config,
      // Placeholder — maskRow() replaces this with the real masked view.
      maskedConfig: {},
    }
  }

  const pool = {
    query: exec,
    // Delegate through pool.query so tests that swap in an overridden query
    // function (e.g. to simulate SQLSTATE 23505) see it inside transactions too.
    connect: async () => ({
      query: (t: string, p?: unknown[]) => pool.query(t, p),
      release: () => {},
    }),
  }
  return { rows, pool, queries, activeTemplateEvents, toResult, exec }
}

/** Build a service with a real (no-key) ProviderSecretsService + harness pool. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeService(h: ReturnType<typeof buildHarness>) {
  return new SmsProviderConfigService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h.pool as any,
    undefined,
    new ProviderSecretsService(undefined),
  )
}

const VALID_CONFIG = {
  api_key: 'smsir_secret_123',
  sender: '9830000000',
  timeout: 15,
  throughput_limit: 100,
  low_credit_threshold: 0,
}

describe('SmsProviderConfigService (T-09.06.02)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let h: ReturnType<typeof buildHarness>
  let svc: SmsProviderConfigService

  beforeEach(() => {
    h = buildHarness()
    svc = makeService(h)
  })

  it('creates a draft and never exposes the plaintext api_key', async () => {
    const created = await svc.create({
      label: 'Prod SMS',
      config: VALID_CONFIG,
      createdBy: 'admin-1',
    })
    expect(created.id).toBeDefined()
    expect(created.status).toBe('draft')
    // maskedConfig may show a masked placeholder, but never the plaintext value.
    const masked = created.maskedConfig.api_key
    if (masked !== undefined) {
      expect(String(masked)).not.toContain('smsir_secret_123')
      expect(String(masked)).toContain('*')
    }
    expect(JSON.stringify(created)).not.toContain('smsir_secret_123')
  })

  it('activate fails before a passing test', async () => {
    const created = await svc.create({ label: 'x', config: VALID_CONFIG, createdBy: 'a1' })
    await expect(svc.activate(created.id, 'admin-1')).rejects.toBeInstanceOf(HttpException)
  })

  it('records a passing test then activates', async () => {
    const created = await svc.create({ label: 'x', config: VALID_CONFIG, createdBy: 'a1' })
    await svc.recordTest(created.id, { passed: true })
    const activated = await svc.activate(created.id, 'admin-1')
    expect(activated.status).toBe('active')
    expect(activated.activatedBy).toBe('admin-1')
  })

  it('supersedes the previous active when a newer config activates', async () => {
    const c1 = await svc.create({ label: 'one', config: VALID_CONFIG, createdBy: 'a1' })
    await svc.recordTest(c1.id, { passed: true })
    await svc.activate(c1.id, 'a1')

    const c2 = await svc.create({ label: 'two', config: VALID_CONFIG, createdBy: 'a1' })
    await svc.recordTest(c2.id, { passed: true })
    const activated = await svc.activate(c2.id, 'a1')

    expect(activated.status).toBe('active')
    const first = await svc.get(c1.id)
    expect(first.status).toBe('superseded')
  })

  it('validates template mappings reference live events on activation', async () => {
    const cfg = {
      ...VALID_CONFIG,
      template_mappings: [
        { event_key: 'otp:login', template_id: '2001', variables: { code: 'code' } },
      ],
    }
    const created = await svc.create({ label: 'x', config: cfg, createdBy: 'a1' })
    await svc.recordTest(created.id, { passed: true })
    const activated = await svc.activate(created.id, 'admin-1')
    expect(activated.status).toBe('active')
  })

  it('rejects activation when a mapped event has no live template', async () => {
    const cfg = {
      ...VALID_CONFIG,
      template_mappings: [
        { event_key: 'unknown:event', template_id: '9999', variables: { a: 'b' } },
      ],
    }
    const created = await svc.create({ label: 'x', config: cfg, createdBy: 'a1' })
    await svc.recordTest(created.id, { passed: true })
    const err = await svc.activate(created.id, 'admin-1').catch((e) => e)
    expect(err).toBeInstanceOf(HttpException)
    expect(err.getResponse().message).toContain('unknown:event')
  })

  it('rollback validates template mappings before re-activating a known-good version', async () => {
    // Activate with a live event, then the event loses its SMS template
    // (simulated by removing it from the live-template set).
    const sourceCfg = {
      ...VALID_CONFIG,
      template_mappings: [{ event_key: 'otp:login', template_id: '2001' }],
    }
    const source = await svc.create({ label: 'old', config: sourceCfg, createdBy: 'a1' })
    await svc.recordTest(source.id, { passed: true })
    await svc.activate(source.id, 'a1')
    await svc.disable(source.id)
    h.activeTemplateEvents.delete('otp:login')

    // Rollbacks clone the stored config; without validation this would re-activate
    // a config pointing at an event with no live template.
    const err = await svc.rollback(source.id, 'admin-1').catch((e) => e)
    expect(err).toBeInstanceOf(HttpException)
    expect(err.getResponse().message).toContain('otp:login')
  })

  it('rollback succeeds when the source template mappings still have live events', async () => {
    const sourceCfg = {
      ...VALID_CONFIG,
      template_mappings: [{ event_key: 'otp:login', template_id: '2001' }],
    }
    const source = await svc.create({ label: 'old', config: sourceCfg, createdBy: 'a1' })
    await svc.recordTest(source.id, { passed: true })
    const activated = await svc.activate(source.id, 'a1')
    expect(activated.status).toBe('active')

    // Disable it, then roll back.
    await svc.disable(source.id)
    const rolledBack = await svc.rollback(source.id, 'admin-1')
    expect(rolledBack.status).toBe('active')
  })
})
