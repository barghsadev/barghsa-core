// Session revocation and expiry are exercised through the migrated HTTP fixture.
vi.mock('../session/session-step-up.js', () => ({
  requireSessionStepUp: vi.fn().mockResolvedValue(undefined),
  requireCurrentSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../storage/reserve-storage-copy.js', () => ({
  writeProvisionalStorageCopy: async (
    _key: string,
    _metadata: unknown,
    write: () => Promise<unknown>
  ) => {
    await write();
    return true;
  },
}));
vi.mock('./staff-mutation-permission.js', () => ({
  requireStaffMutationPermission: vi.fn().mockResolvedValue(undefined),
}));
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { ContractTemplateService as ServiceType } from './contract-template.service.js';

/**
 * SQL-routing mock for @barghsa/db (same pattern as the VAT/gift-code
 * service tests): router.on(fragment, fn) dispatches by SQL content so
 * BEGIN/COMMIT ordering never breaks the queue.
 */
function makeDb() {
  type Handler = (
    values: unknown[],
    callIndex: number
  ) => { rows: unknown[]; rowCount?: number | null };
  const handlers = new Map<string, Handler>();
  const calls: Array<{ sql: string; executor: 'pool' | 'client' }> = [];

  const route = async (
    sql: string,
    values: unknown[]
  ): Promise<{ rows: unknown[]; rowCount?: number | null }> => {
    for (const [frag, fn] of handlers) {
      if (sql.includes(frag)) {
        const idx = calls.filter((c) => c.sql.includes(frag)).length;
        calls.push({ sql, executor: 'client' });
        return fn(values, idx);
      }
    }
    calls.push({ sql, executor: 'client' });
    return { rows: [], rowCount: null };
  };

  const client = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => route(sql, values)),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, executor: 'pool' });
      return route(sql, values);
    }),
    connect: async () => client,
  };

  return {
    query: pool.query,
    router: {
      on: (frag: string, fn: Handler) => handlers.set(frag, fn),
      queries: (frag: string) => calls.filter((c) => c.sql.includes(frag)),
      calls,
    },
    pool,
  };
}

const TEMPLATE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACTOR = 'admin-1';

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
  };
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
  };
}

/** Load the service with a mocked @barghsa/db pool and a mock storage provider. */
async function loadService(pool: { query: ReturnType<typeof vi.fn>; connect: () => unknown }) {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }));
  const { ContractTemplateService: Svc } = await import('./contract-template.service.js');
  const correlationIdProvider = { getCorrelationId: () => 'corr-template-test-1' };
  const storage = {
    putObject: vi.fn().mockResolvedValue(undefined),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };
  const service = new Svc(correlationIdProvider as never, storage as never) as ServiceType;
  return { service, storage };
}

let db: ReturnType<typeof makeDb>;

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  db = makeDb();
  db.router.on('UPDATE storage_records SET status=', () => ({
    rows: [{ storage_key: 'reserved' }],
    rowCount: 1,
  }));
});

function createInput(over: Record<string, unknown> = {}) {
  return {
    name: ' Power Contract ',
    actor: { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
    ip: '127.0.0.1',
    ...over,
  };
}

function reject(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  throw new Error(`expected HttpException, got ${String(error)}`);
}

/** Await a promise, unwrap a rejection into an HttpException, and fail the
 * test if it resolves instead of rejecting (avoids the `.catch(reject)`
 * union type problem). */
async function expectError<T>(p: Promise<T>): Promise<HttpException> {
  try {
    await p;
  } catch (error) {
    return reject(error);
  }
  throw new Error('expected the call to reject, but it resolved');
}

// ─── create ────────────────────────────────────────────────────────────────

describe('ContractTemplateService.create (T-09.12.04)', () => {
  it('trims the name, inserts the template, audits and returns the DTO', async () => {
    db.router.on('FROM contract_templates WHERE LOWER(name) = $1', () => ({ rows: [] }));
    db.router.on('INSERT INTO contract_templates', () => ({ rows: [] }));
    db.router.on(
      'INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)',
      () => ({ rows: [] })
    );
    db.router.on('FROM contract_templates', () => ({
      rows: [templateRow()],
      rowCount: null,
    }));
    db.router.on('COUNT(*)::int AS n FROM contract_template_versions', () => ({
      rows: [{ n: 0 }],
    }));

    const { service } = await loadService(db.pool);
    const dto = await service.create(createInput());

    // Trimmed name persisted; status defaults to active; versionCount 0.
    expect(dto.name).toBe('Power Contract');
    expect(dto.status).toBe('active');
    expect(dto.versionCount).toBe(0);
    expect(dto.latestVersion).toBeNull();

    // The INSERT used the trimmed name and the default active status.
    const insert = db.router.queries('INSERT INTO contract_templates');
    expect(insert.length).toBe(1);
    expect(insert[0]!.sql).toContain('VALUES ($1, $2, $3, $4, $5, $6, $6)');
  });

  it('rejects a duplicate name (case-insensitive) with 409', async () => {
    db.router.on('FROM contract_templates WHERE LOWER(name) = $1', () => ({ rows: [{ id: 'x' }] }));
    const { service } = await loadService(db.pool);
    const error = await expectError(service.create(createInput()));
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_ALREADY_EXISTS' });
  });

  it('rejects a blank name with 400', async () => {
    const { service } = await loadService(db.pool);
    const error = await expectError(service.create(createInput({ name: '   ' })));
    expect(error.getStatus()).toBe(400);
  });
});

// ─── uploadVersion ─────────────────────────────────────────────────────────

describe('ContractTemplateService.uploadVersion (T-09.12.04)', () => {
  it('stores the file, extracts placeholders, appends a version and audits', async () => {
    const auditCalls: unknown[][] = [];
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }));
    db.router.on('SELECT COALESCE(MAX(version_number), 0)::int AS n', () => ({ rows: [{ n: 2 }] }));
    db.router.on('INSERT INTO contract_template_versions', () => ({ rows: [] }));
    db.router.on('INSERT INTO audit_log', (values: unknown[]) => {
      auditCalls.push(values);
      return { rows: [] };
    });

    const { service, storage } = await loadService(db.pool);
    const version = await service.uploadVersion(TEMPLATE_ID, {
      fileName: 'power.docx',
      contentType: 'text/plain',
      content: 'Dear {{customerName}}, amount {{amount}}',
      actor: { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
      ip: '127.0.0.1',
    });

    expect(version.versionNumber).toBe(3);
    expect(version.placeholders).toEqual(['customerName', 'amount']);
    expect(version.fileName).toBe('power.docx');
    // The whitelist-suffix regex preserves a benign extension on the key.
    expect(version.storageKey).toMatch(/^contract-templates\/[0-9a-f-]{36}\.docx$/);
    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).not.toHaveBeenCalled();

    const insert = db.router.queries('INSERT INTO contract_template_versions');
    expect(insert.length).toBe(1);
    // Mandated change_recorded audit with the correct business action/metadata.
    expect(auditCalls.length).toBe(1);
    expect(db.router.queries('INSERT INTO audit_log')[0]!.sql).toContain('change_recorded');
    const auditSqlArg = JSON.parse(String(auditCalls[0]![2]));
    expect(auditSqlArg.entity).toBe('contract_template');
    expect(auditSqlArg.action).toBe('version_uploaded');
    expect(auditSqlArg.versionNumber).toBe(3);
    // uploads serialize version-number allocation via FOR UPDATE row lock.
    expect(db.router.queries('FOR UPDATE').length).toBeGreaterThanOrEqual(1);
  });

  it('returns 503 (with no version row) when object storage write fails', async () => {
    db.router.on('FROM contract_templates', () => ({
      rows: [templateRow()],
    }));
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => db.pool }));
    const { ContractTemplateService: Svc } = await import('./contract-template.service.js');
    const { StorageProviderError } = await import('@barghsa/shared/storage');
    const correlationIdProvider = { getCorrelationId: () => 'corr' };
    const storage = {
      putObject: vi.fn().mockRejectedValue(new StorageProviderError('write failed')),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };
    const service = new Svc(correlationIdProvider as never, storage as never) as ServiceType;
    const error = await expectError(
      service.uploadVersion(TEMPLATE_ID, {
        fileName: 'a.docx',
        content: '{{x}}',
        actor: { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
        ip: 'ip',
      })
    );
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_STORAGE_DISABLED' });
    expect(db.router.queries('INSERT INTO contract_template_versions').length).toBe(0);
  });

  it('leaves failed version writes for durable worker cleanup', async () => {
    const putKeys: string[] = [];
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => db.pool }));
    const { ContractTemplateService: Svc } = await import('./contract-template.service.js');
    const correlationIdProvider = { getCorrelationId: () => 'corr' };
    const storage = {
      putObject: vi.fn(async (_key: string) => {
        putKeys.push(_key);
        return undefined;
      }),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }));
    db.router.on('SELECT COALESCE(MAX(version_number), 0)::int AS n', () => ({ rows: [{ n: 0 }] }));
    db.router.on('INSERT INTO contract_template_versions', () => {
      throw new Error('insert boom');
    });
    const service = new Svc(correlationIdProvider as never, storage as never) as ServiceType;
    await expect(
      service.uploadVersion(TEMPLATE_ID, {
        fileName: 'a.docx',
        content: '{{x}}',
        actor: { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
        ip: 'ip',
      })
    ).rejects.toThrow('insert boom');
    expect(putKeys.length).toBe(1);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('sanitizes the file name to its base — storage key cannot escape the prefix', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }));
    db.router.on('SELECT COALESCE(MAX(version_number), 0)::int AS n', () => ({ rows: [{ n: 0 }] }));
    db.router.on('INSERT INTO contract_template_versions', () => ({ rows: [] }));
    db.router.on('INSERT INTO audit_log', () => ({ rows: [] }));

    const { service, storage } = await loadService(db.pool);
    const version = await service.uploadVersion(TEMPLATE_ID, {
      fileName: '../../evil.d/../../../etc/passwd',
      content: '{{x}}',
      actor: { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
      ip: '127.0.0.1',
    });
    expect(version.fileName).toBe('passwd');
    // The key is built from the SANITIZED basename ('passwd'), not the raw
    // input, and the extension comes from a whitelist-safe regex — no '/',
    // no '..', no '.' beyond the single extension separator.
    expect(version.storageKey).toMatch(/^contract-templates\/[0-9a-f-]{36}$/);
    const putKey = (storage.putObject as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(putKey).toBe(version.storageKey);
    const suffix = putKey.slice('contract-templates/'.length);
    expect(suffix).not.toContain('/');
    expect(suffix).not.toContain('..');
    expect(suffix).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns 503 when object storage is not configured', async () => {
    vi.doMock('@barghsa/db', () => ({ getDbPool: () => db.pool }));
    const { ContractTemplateService: Svc } = await import('./contract-template.service.js');
    const correlationIdProvider = { getCorrelationId: () => 'corr' };
    const service = new Svc(correlationIdProvider as never, null) as ServiceType;
    const error = await expectError(
      service.uploadVersion(TEMPLATE_ID, {
        fileName: 'a.docx',
        content: 'x',
        actor: { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
        ip: 'ip',
      })
    );
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_STORAGE_DISABLED' });
  });

  it('activates an inactive template on its first version', async () => {
    db.router.on('FROM contract_templates', () => ({
      rows: [templateRow({ status: 'inactive' })],
    }));
    db.router.on('SELECT COALESCE(MAX(version_number), 0)::int AS n', () => ({ rows: [{ n: 0 }] }));
    db.router.on('INSERT INTO contract_template_versions', () => ({ rows: [] }));
    db.router.on("UPDATE contract_templates SET status = 'active'", () => ({ rows: [] }));
    db.router.on('INSERT INTO audit_log', () => ({ rows: [] }));

    const { service } = await loadService(db.pool);
    const version = await service.uploadVersion(TEMPLATE_ID, {
      fileName: 'a.docx',
      content: '{{x}}',
      actor: { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
      ip: 'ip',
    });
    expect(version.versionNumber).toBe(1);
    expect(db.router.queries("UPDATE contract_templates SET status = 'active'").length).toBe(1);
  });

  it('rejects an unknown template on upload with 404 before touching storage', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [] }));
    const { service, storage } = await loadService(db.pool);
    const error = await expectError(
      service.uploadVersion(TEMPLATE_ID, {
        fileName: 'a.docx',
        content: '{{x}}',
        actor: { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
        ip: 'ip',
      })
    );
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_NOT_FOUND' });
    expect(storage.putObject).not.toHaveBeenCalled();
  });
});

// ─── update ────────────────────────────────────────────────────────────────

describe('ContractTemplateService.update (T-09.12.04)', () => {
  it('renames with uniqueness checked excluding self (excluding self)', async () => {
    const updateCalls: unknown[][] = [];
    db.router.on('WHERE LOWER(name) = $1 AND id <> $2', () => ({ rows: [] }));
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }));
    db.router.on('UPDATE contract_templates', (values: unknown[]) => {
      updateCalls.push(values);
      return { rows: [] };
    });
    db.router.on('INSERT INTO audit_log', () => ({ rows: [] }));
    db.router.on('COUNT(*)::int AS n FROM contract_template_versions', () => ({
      rows: [{ n: 0 }],
    }));
    db.router.on('FROM contract_template_versions', () => ({ rows: [] }));
    const { service } = await loadService(db.pool);
    await service.update(TEMPLATE_ID, {
      name: 'New Name',
      actor: { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
      ip: 'ip',
    });
    // update() returns readDto which reads back the (still-stale) mock row,
    // but the UPDATE itself must carry the new name and exclude-self params.
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]![0]).toBe('New Name');
    expect(db.router.queries('UPDATE contract_templates').length).toBe(1);
  });

  it('rejects an unknown template on update with 404', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [] }));
    const { service } = await loadService(db.pool);
    const error = await expectError(
      service.update(TEMPLATE_ID, {
        name: 'X',
        actor: { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
        ip: 'ip',
      })
    );
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_NOT_FOUND' });
  });
});

// ─── delete ────────────────────────────────────────────────────────────────

describe('ContractTemplateService.delete (T-09.12.04)', () => {
  it('rejects deleting a versioned template with 409 (archival path)', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }));
    db.router.on('FROM contract_template_versions WHERE template_id = $1 LIMIT 1', () => ({
      rows: [{ id: 'v' }],
    }));
    const { service } = await loadService(db.pool);
    const error = await expectError(
      service.delete(
        TEMPLATE_ID,
        { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
        'ip'
      )
    );
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_VERSIONED' });
  });

  it('rejects deleting a referenced template with 409', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }));
    db.router.on('FROM contract_template_versions WHERE template_id = $1 LIMIT 1', () => ({
      rows: [],
    }));
    db.router.on('FROM contract_type_templates WHERE template_id = $1 LIMIT 1', () => ({
      rows: [{ id: 'r' }],
    }));
    const { service } = await loadService(db.pool);
    const error = await expectError(
      service.delete(
        TEMPLATE_ID,
        { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
        'ip'
      )
    );
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_REFERENCED' });
  });

  it('deletes an unreferenced template with no versions and audits', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }));
    db.router.on('FROM contract_template_versions WHERE template_id = $1 LIMIT 1', () => ({
      rows: [],
    }));
    db.router.on('FROM contract_type_templates WHERE template_id = $1 LIMIT 1', () => ({
      rows: [],
    }));
    db.router.on('DELETE FROM contract_templates', () => ({ rows: [], rowCount: 1 }));
    db.router.on('INSERT INTO audit_log', () => ({ rows: [] }));
    const { service } = await loadService(db.pool);
    const result = await service.delete(
      TEMPLATE_ID,
      { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
      'ip'
    );
    expect(result.deleted).toBe(true);
    expect(db.router.queries('DELETE FROM contract_templates').length).toBe(1);
  });

  it('rejects deleting an unknown template with 404', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [] }));
    const { service } = await loadService(db.pool);
    const error = await expectError(
      service.delete(
        TEMPLATE_ID,
        { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
        'ip'
      )
    );
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_NOT_FOUND' });
  });
});

// ─── get ───────────────────────────────────────────────────────────────────

describe('ContractTemplateService.get (T-09.12.04)', () => {
  it('returns the template with its version history oldest-first', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }));
    db.router.on('COUNT(*)::int AS n FROM contract_template_versions', () => ({
      rows: [{ n: 2 }],
    }));
    db.router.on('FROM contract_template_versions', () => ({
      rows: [
        versionRow({ version_number: 1 }),
        versionRow({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', version_number: 2 }),
      ],
    }));
    const { service } = await loadService(db.pool);
    const dto = await service.get(TEMPLATE_ID);
    expect(dto.versionCount).toBe(2);
    expect(dto.latestVersion!.versionNumber).toBe(2);
    expect(dto.latestVersion!.placeholders).toContain('customerName');
  });

  it('returns 404 for an unknown template', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [] }));
    const { service } = await loadService(db.pool);
    const error = await expectError(service.get(TEMPLATE_ID));
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_NOT_FOUND' });
  });
});

// ─── pg race translation ───────────────────────────────────────────────────

describe('ContractTemplateService pg race translation (T-09.12.04)', () => {
  it('maps uq_contract_template_versions_template_ver 23505 to a retryable 409', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }));
    db.router.on('SELECT COALESCE(MAX(version_number), 0)::int AS n', () => ({ rows: [{ n: 0 }] }));
    db.router.on('INSERT INTO contract_template_versions', () => {
      throw { code: '23505', constraint: 'uq_contract_template_versions_template_ver' };
    });
    const { service } = await loadService(db.pool);
    const error = await expectError(
      service.uploadVersion(TEMPLATE_ID, {
        fileName: 'a.docx',
        content: '{{x}}',
        actor: { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
        ip: 'ip',
      })
    );
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_VERSION_RACE' });
  });

  it('maps uq_contract_template_versions_storage_key 23505 to 409', async () => {
    db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }));
    db.router.on('SELECT COALESCE(MAX(version_number), 0)::int AS n', () => ({ rows: [{ n: 2 }] }));
    db.router.on('INSERT INTO contract_template_versions', () => {
      throw { code: '23505', constraint: 'uq_contract_template_versions_storage_key' };
    });
    const { service } = await loadService(db.pool);
    const error = await expectError(
      service.uploadVersion(TEMPLATE_ID, {
        fileName: 'a.docx',
        content: '{{x}}',
        actor: { userId: ACTOR, sessionId: 'test-session', csrfToken: 'test-csrf' },
        ip: 'ip',
      })
    );
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ error: 'CONTRACT_TEMPLATE_VERSION_CONFLICT' });
  });
});

it('skips version lookup for an empty catalogue and preserves metadata for legacy versions without file size', async () => {
  db.router.on('FROM contract_templates', () => ({ rows: [] }));
  const { service } = await loadService(db.pool);
  await expect(service.list()).resolves.toEqual([]);
  expect(db.router.queries('SELECT DISTINCT ON')).toHaveLength(0);

  db.router.on('FROM contract_templates', () => ({ rows: [templateRow({ version_count: 1 })] }));
  db.router.on('SELECT DISTINCT ON', () => ({ rows: [versionRow({ file_size: null })] }));
  await expect(service.list()).resolves.toEqual([
    expect.objectContaining({
      id: TEMPLATE_ID,
      versionCount: 1,
      latestVersion: expect.objectContaining({ fileSize: null, versionNumber: 1 }),
    }),
  ]);
});

it('keeps existing metadata for a status-only edit and audits explicit description removal', async () => {
  const previous = templateRow({ description: 'Old description' });
  let current = previous;
  let audit: object | undefined;
  db.router.on('FROM contract_templates', () => ({ rows: [current] }));
  db.router.on('UPDATE contract_templates', ([name, description, status, id]) => {
    expect(id).toBe(TEMPLATE_ID);
    current = templateRow({ name, description, status });
    return { rows: [] };
  });
  db.router.on('INSERT INTO audit_log', (args) => {
    audit = JSON.parse(String(args[2])) as object;
    return { rows: [] };
  });
  const { service } = await loadService(db.pool);
  const action = { actor: createInput().actor, ip: '192.0.2.40' };
  await expect(
    service.update(TEMPLATE_ID, { ...action, status: 'inactive' })
  ).resolves.toMatchObject({ description: previous.description, status: 'inactive' });
  expect(audit).toMatchObject({ action: 'updated', status: 'inactive' });
  expect(audit).not.toHaveProperty('description');
  await expect(
    service.update(TEMPLATE_ID, { ...action, description: null })
  ).resolves.toMatchObject({ description: null, status: 'inactive' });
  expect(audit).toMatchObject({ description: null });
  expect(audit).not.toHaveProperty('status');
  expect(db.router.queries('id <> $2')).toHaveLength(0);
});

it('rolls back conflicting names and reports storage publication loss before creating a version', async () => {
  db.router.on('FROM contract_templates', () => ({ rows: [templateRow()] }));
  db.router.on('id <> $2', () => ({ rows: [{ id: 'existing' }] }));
  const { service, storage } = await loadService(db.pool);
  const action = { actor: createInput().actor, ip: '192.0.2.40' };
  await expect(
    service.update(TEMPLATE_ID, { ...action, name: 'Occupied name' })
  ).rejects.toMatchObject({ status: 409, response: { error: 'CONTRACT_TEMPLATE_ALREADY_EXISTS' } });
  db.router.on('UPDATE storage_records SET status=', () => ({ rows: [], rowCount: 0 }));
  await expect(
    service.uploadVersion(TEMPLATE_ID, { ...action, fileName: 'document.txt', content: '{{date}}' })
  ).rejects.toMatchObject({ status: 503 });
  expect(storage.putObject).toHaveBeenCalledOnce();
  expect(db.router.queries('INSERT INTO contract_template_versions')).toHaveLength(0);
  expect(db.router.queries('INSERT INTO audit_log')).toHaveLength(0);
  expect(db.router.queries('ROLLBACK')).toHaveLength(2);
});

it('preserves retryable DB conflicts and leaves unrelated failures visible after rollback', async () => {
  const { service } = await loadService(db.pool);
  const unrelated = new Error('Fixture unavailable');
  for (const [reason, expected] of [
    [
      { code: '23505', constraint: 'uq_contract_templates_name_lower' },
      'CONTRACT_TEMPLATE_ALREADY_EXISTS',
    ],
    [{ code: '23505', constraint: 'unrelated_index' }, 'CONTRACT_TEMPLATE_CONFLICT'],
    [
      { code: '23503', constraint: 'contract_templates_created_by_fkey' },
      'CONTRACT_TEMPLATE_REFERENCED',
    ],
  ] as const) {
    db.router.on('INSERT INTO contract_templates', () => {
      throw reason;
    });
    await expect(
      service.create(createInput({ description: 'Fixture log text' }))
    ).rejects.toMatchObject({ status: 409, response: { error: expected } });
  }
  db.router.on('INSERT INTO contract_templates', () => {
    throw unrelated;
  });
  await expect(service.create(createInput())).rejects.toBe(unrelated);
  expect(db.router.queries('ROLLBACK')).toHaveLength(4);
  expect(db.router.queries('COMMIT')).toHaveLength(0);
  expect(db.router.queries('INSERT INTO audit_log')).toHaveLength(0);
});

it('retains description audit on create and rejects invalid values before storage or database changes', async () => {
  const { service, storage } = await loadService(db.pool);
  const action = { actor: createInput().actor, ip: '192.0.2.40' };
  for (const fileName of [' ', 'folder/', 'folder/.', 'folder/..', 'folder/  ', null as never]) {
    await expect(
      service.uploadVersion(TEMPLATE_ID, { ...action, fileName, content: 'template' })
    ).rejects.toMatchObject({ status: 400, response: { error: 'CONTRACT_TEMPLATE_INVALID_FILE' } });
  }
  await expect(
    service.uploadVersion(TEMPLATE_ID, {
      ...action,
      fileName: 'template.txt',
      content: null as never,
    })
  ).rejects.toMatchObject({ status: 400, response: { error: 'CONTRACT_TEMPLATE_INVALID_FILE' } });
  for (const name of [null, 'a'.repeat(201)]) {
    await expect(service.create(createInput({ name }))).rejects.toMatchObject({ status: 400 });
  }
  expect(storage.putObject).not.toHaveBeenCalled();
  expect(db.router.calls).toHaveLength(0);

  const description = 'Document metadata';
  let audit: object | undefined;
  db.router.on('FROM contract_templates WHERE LOWER(name) = $1', () => ({ rows: [] }));
  db.router.on('FROM contract_templates', () => ({ rows: [templateRow({ description })] }));
  db.router.on('INSERT INTO audit_log', (args) => {
    audit = JSON.parse(String(args[2])) as object;
    return { rows: [] };
  });
  await expect(service.create(createInput({ description }))).resolves.toMatchObject({
    description,
  });
  expect(audit).toMatchObject({ action: 'created', description });
});
