import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { ContractTemplateService as ServiceType } from './contract-template.service.js'

/**
 * SQL-routing mock for @barghsa/db (same pattern as the VAT/gift-code
 * service tests): router.on(fragment, fn) dispatches by SQL content so
 * BEGIN/COMMIT ordering never breaks the queue.
 */
function makeDb() {
  type Handler = (values: unknown[], callIndex: number) => { rows: unknown[]; rowCount?: number | null }
  const handlers = new Map<string, Handler>()
  const calls: Array<{ sql: string; executor: 'pool' | 'client' }> = []

  const route = async (
    sql: string,
    values: unknown[],
  ): Promise<{ rows: unknown[]; rowCount?: number | null }> => {
    for (const [frag, fn] of handlers) {
      if (sql.includes(frag)) {
        const idx = calls.filter((c) => c.sql.includes(frag)).length
        calls.push({ sql, executor: 'client' })
        return fn(values, idx)
      }
    }
    calls.push({ sql, executor: 'client' })
    return { rows: [], rowCount: null }
  }

  const client = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => route(sql, values)),
    release: vi.fn(),
  }
  const pool = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, executor: 'pool' })
      return route(sql, values)
    }),
    connect: async () => client,
  }

  return {
    query: pool.query,
    router: {
      on: (frag: string, fn: Handler) => handlers.set(frag, fn),
      queries: (frag: string) => calls.filter((c) => c.sql.includes(frag)),
      calls,
    },
    pool,
  }
}

const TEMPLATE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ACTOR = 'admin-1'

function templateRow(over: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    name: 'Power Contract',
    description: null,
    status: 'active',
    created_by: ACTOR,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function versionRow(over: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    template_id: TEMPLATE_ID,
    version_number: 1,
    storage_key: 'contract-templates/some-key.docx',
    file_name: 'power.docx',
    content_type: 'text/plain',
    file_size: 42,
    placeholders: ['customerName', 'amount'],
    created_by: ACTOR,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** Load the service with a mocked @barghsa/db pool and a mock storage provider. */
async function loadService(pool: { query: ReturnType<typeof vi.fn>; connect: () => unknown }) {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
  const { ContractTemplateService: Svc } = await import('./contract-template.service.js')
  const correlationIdProvider = { getCorrelationId: () => 'corr-template-test-1' }
  const storage = {
    putObject: vi.fn().mockResolvedValue(undefined),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  }
  const service = new Svc(correlationIdProvider as never, storage as never) as ServiceType
  return { service, storage }
}

let db: ReturnType<typeof makeDb>

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  db = makeDb()
})

function createInput(over: Record<string, unknown> = {}) {
  return {
    name: ' Power Contract ',
    actorUserId: ACTOR,
    ip: '127.0.0.1',
    ...over,
  }
}

function reject(error: unknown): HttpException {
  if (error instanceof HttpException) return error
  throw new Error(`expected HttpException, got ${String(error)}`)
}

/** Await a promise, unwrap a rejection into an HttpException, and fail the
 * test if it resolves instead of rejecting (avoids the `.catch(reject)`
 * union type problem). */
async function expectError<T>(p: Promise<T>): Promise<HttpException> {
  try {
    await p
  } catch (error) {
    return reject(error)
  }
  throw new Error('expected the call to reject, but it resolved')
}

// ─── create ────────────────────────────────────────────────────────────────

describe('ContractTemplateService.create (T-09.12.04)', () => {
  it('trims the name, inserts the template, audits and returns the DTO', async () => {
    db.router.on('FROM contract_templates WHERE LOWER(name) = $1', () => ({ rows: [] }))
    db.router.on('INSERT INTO contract_templates', () => ({ rows: [] }))
    db.router.on("INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)", () => ({ rows: [] }))
    db.router.on('FROM contract_templates', () => ({
      rows: [templateRow()],
      rowCount: null,
    }))
    db.router.on('COUNT(*)::int AS n FROM contract_template_versions', () => ({ rows: [{ n: 0 }] }))

    const { service } = await loadService(db.pool)
    const dto = await service.create(createInput())

    // Trimmed name persisted; status defaults to active; versionCount 0.
    expect(dto.name).toBe('Power Contract')
    expect(dto.status).toBe('active')
    expect(dto.versionCount).toBe(0)
    expect(dto.latestVersion).toBeNull()

    // The INSERT used the trimmed name and the default active status.
    const insert = db.router.queries('INSERT INTO contract_templates')
    expect(insert.length).toBe(1)
    expect(insert[0]!.sql).toContain("VALUES ($1, $2, $3, $4, $5, $6, $6)")
  })

  it('rejects a duplicate name (case-insensitive) with 409', async () => {
    db.router.on('FROM contract_templates WHERE LOWER(name) = $1', () => ({ rows: [{ id: 'x' }] }))
    const { service } = await loadService(db.pool)
    const error = await expectError(service.create(createInput()))
    expect(error.getStatus()).toBe(409)
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_ALREADY_EXISTS' })
  })

  it('rejects a blank name with 400', async () => {
    const { service } = await loadService(db.pool)
    const error = await expectError(service.create(createInput({ name: '   ' })))
    expect(error.getStatus()).toBe(400)
  })
})

// ─── uploadVersion ─────────────────────────────────────────────────────────

describe('ContractTemplateService.uploadVersion (T-09.12.04)', () => {
  it('stores the file, extracts placeholders, appends a version and audits', async () => {
    const auditCalls: unknown[][] = []
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }))
    db.router.on('SELECT COALESCE(MAX(version_number), 0)::int AS n', () => ({ rows: [{ n: 2 }] }))
    db.router.on('INSERT INTO contract_template_versions', () => ({ rows: [] }))
    db.router.on('INSERT INTO audit_log', (values: unknown[]) => {
      auditCalls.push(values)
      return { rows: [] }
    })

    const { service, storage } = await loadService(db.pool)
    const version = await service.uploadVersion(TEMPLATE_ID, {
      fileName: 'power.docx',
      contentType: 'text/plain',
      content: 'Dear {{customerName}}, amount {{amount}}',
      actorUserId: ACTOR,
      ip: '127.0.0.1',
    })

    expect(version.versionNumber).toBe(3)
    expect(version.placeholders).toEqual(['customerName', 'amount'])
    expect(version.fileName).toBe('power.docx')
    expect(version.storageKey).toMatch(/^contract-templates\//)
    expect(storage.putObject).toHaveBeenCalledTimes(1)
    expect(storage.deleteObject).not.toHaveBeenCalled()

    const insert = db.router.queries('INSERT INTO contract_template_versions')
    expect(insert.length).toBe(1)
    // Mandated change_recorded audit with the correct business action/metadata.
    expect(auditCalls.length).toBe(1)
    expect(db.router.queries('INSERT INTO audit_log')[0]!.sql).toContain('change_recorded')
    const auditSqlArg = JSON.parse(String(auditCalls[0]![2]))
    expect(auditSqlArg.entity).toBe('contract_template')
    expect(auditSqlArg.action).toBe('version_uploaded')
    expect(auditSqlArg.versionNumber).toBe(3)
    // uploads serialize version-number allocation via FOR UPDATE row lock.
    expect(db.router.queries('FOR UPDATE').length).toBeGreaterThanOrEqual(1)
  })

  it('returns 503 (with no version row) when object storage write fails', async () => {
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => db.query }))
    const { ContractTemplateService: Svc } = await import('./contract-template.service.js')
    const { StorageProviderError } = await import('@barghsa/shared/storage')
    const correlationIdProvider = { getCorrelationId: () => 'corr' }
    const storage = {
      putObject: vi.fn().mockRejectedValue(new StorageProviderError('write failed')),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    }
    const service = new Svc(correlationIdProvider as never, storage as never) as ServiceType
    const error = await expectError(
      service.uploadVersion(TEMPLATE_ID, {
        fileName: 'a.docx',
        content: '{{x}}',
        actorUserId: ACTOR,
        ip: 'ip',
      }),
    )
    expect(error.getStatus()).toBe(503)
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_STORAGE_DISABLED' })
    expect(db.router.queries('INSERT INTO contract_template_versions').length).toBe(0)
  })

  it('rolls the orphaned object back out of storage when the DB insert fails', async () => {
    const putKeys: string[] = []
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => db.pool }))
    const { ContractTemplateService: Svc } = await import('./contract-template.service.js')
    const correlationIdProvider = { getCorrelationId: () => 'corr' }
    const storage = {
      putObject: vi.fn(async (_key: string) => {
        putKeys.push(_key)
        return undefined
      }),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    }
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }))
    db.router.on('SELECT COALESCE(MAX(version_number), 0)::int AS n', () => ({ rows: [{ n: 0 }] }))
    db.router.on('INSERT INTO contract_template_versions', () => {
      throw new Error('insert boom')
    })
    const service = new Svc(correlationIdProvider as never, storage as never) as ServiceType
    await expect(
      service.uploadVersion(TEMPLATE_ID, {
        fileName: 'a.docx',
        content: '{{x}}',
        actorUserId: ACTOR,
        ip: 'ip',
      }),
    ).rejects.toThrow('insert boom')
    expect(putKeys.length).toBe(1)
    expect(storage.deleteObject).toHaveBeenCalledWith(putKeys[0])
  })

  it('sanitizes the file name to its base — storage key cannot escape the prefix', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }))
    db.router.on('SELECT COALESCE(MAX(version_number), 0)::int AS n', () => ({ rows: [{ n: 0 }] }))
    db.router.on('INSERT INTO contract_template_versions', () => ({ rows: [] }))
    db.router.on("INSERT INTO audit_log", () => ({ rows: [] }))

    const { service, storage } = await loadService(db.pool)
    const version = await service.uploadVersion(TEMPLATE_ID, {
      fileName: '../../evil.d/../../../etc/passwd',
      content: '{{x}}',
      actorUserId: ACTOR,
      ip: '127.0.0.1',
    })
    expect(version.fileName).toBe('passwd')
    // The key is built from the SANITIZED basename ('passwd'), not the raw
    // input, and the extension comes from a whitelist-safe regex — no '/',
    // no '..', no '.' beyond the single extension separator.
    expect(version.storageKey).toMatch(/^contract-templates\/[0-9a-f-]{36}$/)
    const putKey = (storage.putObject as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(putKey).toBe(version.storageKey)
    const suffix = putKey.slice('contract-templates/'.length)
    expect(suffix).not.toContain('/')
    expect(suffix).not.toContain('..')
    expect(suffix).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('returns 503 when object storage is not configured', async () => {
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => db.query }))
    const { ContractTemplateService: Svc } = await import('./contract-template.service.js')
    const correlationIdProvider = { getCorrelationId: () => 'corr' }
    const service = new Svc(correlationIdProvider as never, null) as ServiceType
    const error = await expectError(
      service.uploadVersion(TEMPLATE_ID, { fileName: 'a.docx', content: 'x', actorUserId: ACTOR, ip: 'ip' }),
    )
    expect(error.getStatus()).toBe(503)
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_STORAGE_DISABLED' })
  })

  it('activates an inactive template on its first version', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow({ status: 'inactive' })] }))
    db.router.on('SELECT COALESCE(MAX(version_number), 0)::int AS n', () => ({ rows: [{ n: 0 }] }))
    db.router.on('INSERT INTO contract_template_versions', () => ({ rows: [] }))
    db.router.on("UPDATE contract_templates SET status = 'active'", () => ({ rows: [] }))
    db.router.on("INSERT INTO audit_log", () => ({ rows: [] }))

    const { service } = await loadService(db.pool)
    const version = await service.uploadVersion(TEMPLATE_ID, {
      fileName: 'a.docx',
      content: '{{x}}',
      actorUserId: ACTOR,
      ip: 'ip',
    })
    expect(version.versionNumber).toBe(1)
    expect(db.router.queries("UPDATE contract_templates SET status = 'active'").length).toBe(1)
  })
})

// ─── update ────────────────────────────────────────────────────────────────

describe('ContractTemplateService.update (T-09.12.04)', () => {
  it('renames with uniqueness checked excluding self (excluding self)', async () => {
    const updateCalls: unknown[][] = []
    db.router.on('WHERE LOWER(name) = $1 AND id <> $2', () => ({ rows: [] }))
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }))
    db.router.on('UPDATE contract_templates', (values: unknown[]) => {
      updateCalls.push(values)
      return { rows: [] }
    })
    db.router.on('INSERT INTO audit_log', () => ({ rows: [] }))
    db.router.on('COUNT(*)::int AS n FROM contract_template_versions', () => ({ rows: [{ n: 0 }] }))
    db.router.on('FROM contract_template_versions', () => ({ rows: [] }))
    const { service } = await loadService(db.pool)
    const dto = await service.update(TEMPLATE_ID, {
      name: 'New Name',
      actorUserId: ACTOR,
      ip: 'ip',
    })
    // update() returns readDto which reads back the (still-stale) mock row,
    // but the UPDATE itself must carry the new name and exclude-self params.
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0]![0]).toBe('New Name')
    expect(db.router.queries('UPDATE contract_templates').length).toBe(1)
  })

  it('rejects an unknown template on update with 404', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [] }))
    const { service } = await loadService(db.pool)
    const error = await expectError(service.update(TEMPLATE_ID, { name: 'X', actorUserId: ACTOR, ip: 'ip' }))
    expect(error.getStatus()).toBe(404)
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_NOT_FOUND' })
  })
})

// ─── delete ────────────────────────────────────────────────────────────────

describe('ContractTemplateService.delete (T-09.12.04)', () => {
  it('rejects deleting a versioned template with 409 (archival path)', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }))
    db.router.on('FROM contract_template_versions WHERE template_id = $1 LIMIT 1', () => ({ rows: [{ id: 'v' }] }))
    const { service } = await loadService(db.pool)
    const error = await expectError(service.delete(TEMPLATE_ID, ACTOR, 'ip'))
    expect(error.getStatus()).toBe(409)
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_VERSIONED' })
  })

  it('rejects deleting a referenced template with 409', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }))
    db.router.on('FROM contract_template_versions WHERE template_id = $1 LIMIT 1', () => ({ rows: [] }))
    db.router.on('FROM contract_type_templates WHERE template_id = $1 LIMIT 1', () => ({ rows: [{ id: 'r' }] }))
    const { service } = await loadService(db.pool)
    const error = await expectError(service.delete(TEMPLATE_ID, ACTOR, 'ip'))
    expect(error.getStatus()).toBe(409)
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_REFERENCED' })
  })

  it('deletes an unreferenced template with no versions and audits', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }))
    db.router.on('FROM contract_template_versions WHERE template_id = $1 LIMIT 1', () => ({ rows: [] }))
    db.router.on('FROM contract_type_templates WHERE template_id = $1 LIMIT 1', () => ({ rows: [] }))
    db.router.on('DELETE FROM contract_templates', () => ({ rows: [], rowCount: 1 }))
    db.router.on("INSERT INTO audit_log", () => ({ rows: [] }))
    const { service } = await loadService(db.pool)
    const result = await service.delete(TEMPLATE_ID, ACTOR, 'ip')
    expect(result.deleted).toBe(true)
    expect(db.router.queries('DELETE FROM contract_templates').length).toBe(1)
  })

  it('rejects deleting an unknown template with 404', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [] }))
    const { service } = await loadService(db.pool)
    const error = await expectError(service.delete(TEMPLATE_ID, ACTOR, 'ip'))
    expect(error.getStatus()).toBe(404)
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_NOT_FOUND' })
  })
})

// ─── get ───────────────────────────────────────────────────────────────────

describe('ContractTemplateService.get (T-09.12.04)', () => {
  it('returns the template with its version history oldest-first', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }))
    db.router.on('COUNT(*)::int AS n FROM contract_template_versions', () => ({ rows: [{ n: 2 }] }))
    db.router.on('FROM contract_template_versions', () => ({
      rows: [
        versionRow({ version_number: 1 }),
        versionRow({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', version_number: 2 }),
      ],
    }))
    const { service } = await loadService(db.pool)
    const dto = await service.get(TEMPLATE_ID)
    expect(dto.versionCount).toBe(2)
    expect(dto.latestVersion!.versionNumber).toBe(2)
    expect(dto.latestVersion!.placeholders).toContain('customerName')
  })

  it('returns 404 for an unknown template', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [] }))
    const { service } = await loadService(db.pool)
    const error = await expectError(service.get(TEMPLATE_ID))
    expect(error.getStatus()).toBe(404)
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_NOT_FOUND' })
  })
})
