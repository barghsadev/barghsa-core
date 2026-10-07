import { HttpException } from '@nestjs/common';
import { beforeEach, expect, it, vi } from 'vitest';
import type * as DbModule from '@barghsa/db';
import { ContractService } from '../contract/contract.service.js';

const h = vi.hoisted(() => ({
  connect: vi.fn(),
  permission: vi.fn(),
  current: vi.fn(),
  stepUp: vi.fn(),
}));
vi.mock('@barghsa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getDbPool: () => ({ connect: h.connect }),
}));
vi.mock('../admin/staff-mutation-permission.js', () => ({
  requireStaffMutationPermission: h.permission,
}));
vi.mock('../session/session-step-up.js', () => ({
  requireCurrentSession: h.current,
  requireSessionStepUp: h.stepUp,
}));
const id = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const actor = { userId: 'opaque-staff', sessionId: id, csrfToken: 'csrf' };
beforeEach(() => {
  vi.resetAllMocks();
  for (const m of [h.permission, h.current, h.stepUp]) m.mockResolvedValue(undefined);
});
function fixture() {
  const state = {
    profile: true,
    archived: false,
    request: true,
    status: 'approved',
    contract: null as string | null,
  };
  const order: string[] = [];
  const client = {
    query: vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>(
      async (sql, values) => {
        order.push(sql);
        return {
          rows: sql.includes('FROM profiles')
            ? state.profile
              ? [{ archived: state.archived }]
              : []
            : sql.includes('FROM solar_construction_requests') &&
                state.request &&
                values?.[0] === id &&
                values?.[1] === profileId
              ? [{ status: state.status, contract_id: state.contract }]
              : [],
        };
      }
    ),
    release: vi.fn(),
  };
  h.connect.mockResolvedValue(client);
  h.permission.mockImplementation(async (_client, _actor, grant) => {
    order.push(grant);
  });
  h.current.mockImplementation(async () => {
    order.push('current');
  });
  h.stepUp.mockImplementation(async () => {
    order.push('stepUp');
  });
  const createManualInvoice = vi.fn(),
    resolve = vi.fn();
  const service = new ContractService(
    { createManualInvoice } as never,
    { resolve } as never,
    {} as never
  );
  return { state, order, client, service, createManualInvoice, resolve };
}
function noEffects(f: ReturnType<typeof fixture>) {
  expect(f.createManualInvoice).not.toHaveBeenCalled();
  expect(f.resolve).not.toHaveBeenCalled();
  for (const [sql] of f.client.query.mock.calls)
    expect(sql).not.toMatch(/^(INSERT|UPDATE|DELETE)|idempotent_mutations|audit_log|notifications/);
}
it.each([false, true])(
  'invalid-owned preflight preserves exact grants, session and profile-first lock order write=%s',
  async (write) => {
    const f = fixture();
    await f.service.assertCanEditSolarContract(id, profileId, actor, write);
    expect(h.permission.mock.calls.map((call) => call[2])).toEqual([
      'contracts:write',
      ...(write ? ['invoices:write'] : []),
    ]);
    const session = write ? h.stepUp : h.current;
    expect(session).toHaveBeenCalledTimes(2);
    expect(write ? h.current : h.stepUp).not.toHaveBeenCalled();
    expect(f.order[0]).toBe('BEGIN');
    expect(f.order[1]).toBe('SELECT archived FROM profiles WHERE id=$1 FOR UPDATE');
    expect(f.order[2]).toBe('contracts:write');
    expect(f.order[3]).toBe(write ? 'stepUp' : 'current');
    expect(f.order[4]).toContain(`WHERE id=$1 AND profile_id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`);
    expect(f.order.at(-1)).toBe('COMMIT');
    expect(f.client.release).toHaveBeenCalledOnce();
    noEffects(f);
  }
);
it.each([false, true])(
  'withdraws absent, archived, foreign or no-longer-editable sources write=%s',
  async (write) => {
    for (const [patch, selectedProfile, status] of [
      [{ profile: false }, profileId, 404],
      [{ archived: true }, profileId, 409],
      [{ request: false }, profileId, 404],
      [{}, id, 404],
      [{ status: 'contract_created' }, profileId, 409],
      [{ contract: id }, profileId, 409],
    ] as const) {
      const f = fixture();
      Object.assign(f.state, patch);
      await expect(
        f.service.assertCanEditSolarContract(id, selectedProfile, actor, write)
      ).rejects.toMatchObject({ status });
      expect(f.client.query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(f.client.release).toHaveBeenCalledOnce();
      noEffects(f);
    }
  }
);
it.each([false, true])(
  'preserves live grants and initial/final current-session denial write=%s',
  async (write) => {
    const denied = new HttpException('Current authority', 403);
    for (const grant of ['contracts:write', ...(write ? ['invoices:write'] : [])]) {
      const f = fixture();
      h.permission.mockImplementation(async (_client, _actor, permission) => {
        if (permission === grant) throw denied;
      });
      await expect(f.service.assertCanEditSolarContract(id, profileId, actor, write)).rejects.toBe(
        denied
      );
      expect(f.client.query).toHaveBeenLastCalledWith('ROLLBACK');
      noEffects(f);
    }
    for (const final of [false, true]) {
      const f = fixture(),
        session = write ? h.stepUp : h.current;
      if (final) session.mockResolvedValueOnce(undefined);
      session.mockRejectedValueOnce(denied);
      await expect(f.service.assertCanEditSolarContract(id, profileId, actor, write)).rejects.toBe(
        denied
      );
      expect(f.client.query).toHaveBeenLastCalledWith('ROLLBACK');
      noEffects(f);
    }
  }
);
it.each([false, true])(
  'rejects invalid protected identifiers before database queries write=%s',
  async (write) => {
    const f = fixture();
    for (const [requestId, selectedProfile] of [
      ['PRIVATE', profileId],
      [id, 'PRIVATE'],
    ])
      await expect(
        f.service.assertCanEditSolarContract(requestId!, selectedProfile!, actor, write)
      ).rejects.toMatchObject({ status: 400 });
    expect(h.connect).not.toHaveBeenCalled();
    noEffects(f);
  }
);
it('returns the original actor-key/full-command receipt before new eligibility without invoking engines', async () => {
  const f = fixture();
  f.state.archived = true;
  f.state.status = 'contract_created';
  f.state.contract = id;
  const input = {
    requestId: id,
    profileId,
    idempotencyKey: id,
    title: 'Captured title',
    text: 'Captured terms',
    changeDescription: 'Captured issue',
    commercialValue: { kind: 'fixed' as const, amountIrr: '0' },
    source: { kind: 'template' as const, templateVersionId: id },
    invoiceLines: [
      { description: 'Deposit', quantity: 1, unitPrice: '10', vatRate: 0, isTaxable: false },
    ],
    expectedReviewHash: 'a'.repeat(64),
  };
  const result = { status: 'contract_created', contractId: id, invoiceIds: [profileId] };
  const query = f.client.query.getMockImplementation()!;
  let matches = true;
  f.client.query.mockImplementation(async (sql, values) =>
    sql.includes("response->'request'") ? { rows: [{ matches, result }] } : query(sql, values)
  );
  expect(await f.service.createSolar(input, actor, '127.0.0.1')).toBe(result);
  expect(f.client.query).toHaveBeenCalledWith(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [`solar_contract_create:${actor.userId}:${id}`]
  );
  expect(
    f.client.query.mock.calls.find(([sql]) => sql.includes("response->'request'"))?.[1]
  ).toEqual(['solar_contract_create', `${actor.userId}:${id}`, JSON.stringify(input)]);
  expect(
    f.client.query.mock.calls.some(([sql]) => sql.includes('FROM solar_construction_requests'))
  ).toBe(false);
  expect(f.createManualInvoice).not.toHaveBeenCalled();
  expect(f.resolve).not.toHaveBeenCalled();
  expect(h.stepUp).toHaveBeenCalledTimes(2);
  matches = false;
  await expect(
    f.service.createSolar({ ...input, expectedReviewHash: 'b'.repeat(64) }, actor, '127.0.0.1')
  ).rejects.toMatchObject({ status: 409 });
  expect(f.client.query).toHaveBeenLastCalledWith('ROLLBACK');
});
