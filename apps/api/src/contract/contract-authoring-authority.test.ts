import { HttpException } from '@nestjs/common';
import { beforeEach, expect, it, vi } from 'vitest';
import type * as DbModule from '@barghsa/db';
import { ContractService } from './contract.service.js';

const h = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  permission: vi.fn(),
  stepUp: vi.fn(),
  current: vi.fn(),
}));
vi.mock('@barghsa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getDbPool: () => ({ query: h.query, connect: h.connect }),
}));
vi.mock('../admin/staff-mutation-permission.js', () => ({
  requireStaffMutationPermission: h.permission,
}));
vi.mock('../session/session-step-up.js', () => ({
  requireCurrentSession: h.current,
  requireSessionStepUp: h.stepUp,
}));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const profileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const versionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const orderId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const actor = { userId: 'opaque-staff', sessionId: id, csrfToken: 'current-csrf' };
const actions = ['create', 'update', 'amendment'] as const;
type Action = (typeof actions)[number];
beforeEach(() => {
  vi.resetAllMocks();
  h.permission.mockResolvedValue(undefined);
  h.stepUp.mockResolvedValue(undefined);
});
function fixture(action: Action) {
  const state = {
    identity: true,
    profile: true,
    archived: false,
    contract: true,
    currentVersion: versionId,
    status: action === 'amendment' ? 'Active' : 'Draft',
    pending: false,
    order: true,
    orderProfile: profileId,
    orderType: 'savings',
    orderStatus: 'PENDING',
  };
  const sequence: string[] = [];
  const client = {
    query: vi.fn<
      (
        sql: string,
        values?: unknown[]
      ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
    >(async (sql, values) => {
      sequence.push(sql);
      let rows: Record<string, unknown>[] = [];
      if (sql.includes('FROM profiles WHERE'))
        rows = state.profile ? [{ archived: state.archived }] : [];
      else if (sql.includes('FROM contracts WHERE'))
        rows =
          state.contract && values?.[0] === id && values?.[1] === profileId
            ? [{ state: state.status, current_version_id: state.currentVersion }]
            : [];
      else if (sql.includes('FROM orders WHERE'))
        rows =
          state.order && values?.[0] === orderId
            ? [
                {
                  profile_id: state.orderProfile,
                  order_type: state.orderType,
                  status: state.orderStatus,
                },
              ]
            : [];
      else if (sql.includes('FROM contract_amendments'))
        rows = state.pending ? [{ present: true }] : [];
      return { rows, rowCount: rows.length };
    }),
    release: vi.fn(),
  };
  h.connect.mockResolvedValue(client);
  h.query.mockImplementation(async () => ({
    rows: state.identity ? [{ profile_id: profileId }] : [],
  }));
  h.permission.mockImplementation(async (_client, _actor, grant) => {
    sequence.push(grant);
  });
  h.stepUp.mockImplementation(async () => {
    sequence.push('stepUp');
  });
  const service = new ContractService({} as never, {} as never);
  const get = vi
    .spyOn(service, 'get')
    .mockResolvedValue({ original: 'must not be inferred from GET' } as never);
  const body = {
    profileId: profileId.toUpperCase(),
    serviceType: 'savings',
    orderId: orderId.toUpperCase(),
    expectedVersionId: versionId.toUpperCase(),
    changeDescription: '',
  };
  const invoke = (
    raw: Record<string, unknown> = body,
    resource: string | null = action === 'create' ? null : id.toUpperCase()
  ) => service.assertCanAuthorDraft(action, resource, raw, actor);
  return { state, sequence, client, service, get, body, invoke };
}
function noEffects(f: ReturnType<typeof fixture>) {
  expect(f.get).not.toHaveBeenCalled();
  expect(h.current).not.toHaveBeenCalled();
  for (const [sql] of f.client.query.mock.calls)
    expect(sql).not.toMatch(
      /^(INSERT|UPDATE|DELETE)|idempotency_keys|pg_advisory|audit_log|notifications/
    );
}
it.each(actions)(
  '%s invalid-only preflight preserves profile-first nonfinancial locks and fresh step-up',
  async (action) => {
    const f = fixture(action);
    await f.invoke();
    expect(f.sequence.slice(0, 4)).toEqual([
      'BEGIN',
      'SELECT archived FROM profiles WHERE id=$1 FOR SHARE',
      'contracts:write',
      'stepUp',
    ]);
    expect(h.permission).toHaveBeenCalledExactlyOnceWith(f.client, actor.userId, 'contracts:write');
    expect(h.stepUp).toHaveBeenCalledTimes(2);
    expect(f.sequence.at(-1)).toBe('COMMIT');
    expect(f.client.release).toHaveBeenCalledOnce();
    if (action === 'create') expect(h.query).not.toHaveBeenCalled();
    else
      expect(f.client.query).toHaveBeenCalledWith(
        'SELECT state,current_version_id FROM contracts WHERE id=$1 AND profile_id=$2 FOR SHARE',
        [id, profileId]
      );
    noEffects(f);
  }
);
it.each(actions)(
  '%s feedback cannot precede current missing, archived or stale source checks',
  async (action) => {
    for (const [patch, status] of [
      [{ profile: false }, 404],
      [{ archived: true }, 409],
      ...(action === 'create'
        ? ([[{ order: false }, 409]] as const)
        : ([
            [{ identity: false }, 404],
            [{ contract: false }, 404],
            [{ currentVersion: id }, 409],
            [{ status: 'Cancelled' }, 409],
          ] as const)),
      ...(action === 'amendment' ? ([[{ pending: true }, 409]] as const) : []),
    ] as const) {
      const f = fixture(action);
      Object.assign(f.state, patch);
      await expect(f.invoke()).rejects.toMatchObject({ status });
      noEffects(f);
    }
  }
);
it.each(actions)(
  '%s revoked live grant or initial/final step-up overrides field metadata',
  async (action) => {
    for (const boundary of ['permission', 'initial', 'final']) {
      const f = fixture(action);
      const denied = new HttpException('Current source authority', 403);
      if (boundary === 'permission') h.permission.mockRejectedValueOnce(denied);
      else {
        if (boundary === 'final') h.stepUp.mockResolvedValueOnce(undefined);
        h.stepUp.mockRejectedValueOnce(denied);
      }
      await expect(f.invoke()).rejects.toBe(denied);
      expect(f.client.query).toHaveBeenLastCalledWith('ROLLBACK');
      noEffects(f);
    }
  }
);
it.each(actions)(
  '%s malformed protected scope identifiers never reach UUID SQL',
  async (action) => {
    const f = fixture(action);
    const inputs =
      action === 'create'
        ? [
            { ...f.body, profileId: 'PRIVATE' },
            { ...f.body, orderId: 'PRIVATE' },
            { ...f.body, serviceType: ['savings'] },
          ]
        : [{ ...f.body, expectedVersionId: 'PRIVATE' }];
    for (const input of inputs)
      await expect(f.invoke(input)).rejects.toMatchObject({ status: 404 });
    if (action !== 'create')
      await expect(f.invoke(f.body, 'PRIVATE')).rejects.toMatchObject({ status: 404 });
    expect(h.query).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
    noEffects(f);
  }
);
it('create requires the optional order to match the live profile and service and remain available', async () => {
  for (const patch of [
    { orderProfile: id },
    { orderType: 'solar' },
    { orderStatus: 'CANCELLED' },
  ]) {
    const f = fixture('create');
    Object.assign(f.state, patch);
    await expect(f.invoke()).rejects.toMatchObject({ status: 409 });
    noEffects(f);
  }
  const f = fixture('create');
  const { orderId: _order, ...body } = f.body;
  await f.invoke(body);
  expect(f.client.query.mock.calls.some(([sql]) => sql.includes('FROM orders'))).toBe(false);
  noEffects(f);
});
it.each(['update', 'amendment'] as const)(
  '%s allows only the original authoring states for its current exact version',
  async (action) => {
    const f = fixture(action);
    for (const state of action === 'update'
      ? ['Draft', 'ChangesRequested']
      : ['Accepted', 'Signed', 'Active']) {
      f.state.status = state;
      await f.invoke();
    }
    noEffects(f);
  }
);
it.each(actions)(
  '%s keeps original actor-key/full-body replay ahead of changed new-write eligibility',
  async (action) => {
    const f = fixture(action);
    f.state.archived = true;
    f.state.status = 'Cancelled';
    f.state.currentVersion = id;
    f.state.pending = true;
    const input = {
      content: {
        imported: { preserved: true },
        commercialValue: { kind: 'fixed' as const, amountIrr: '0' },
      },
      changeDescription: 'Captured original command',
      idempotencyKey: id,
      ...(action === 'create'
        ? { profileId, serviceType: 'savings' as const }
        : { expectedVersionId: versionId }),
    };
    const original = f.client.query.getMockImplementation()!;
    const saved = { original: 'durable full original result' };
    let matches = true;
    f.client.query.mockImplementation(async (sql, values) =>
      sql.includes("response->'request'")
        ? { rows: [{ matches, result: saved }], rowCount: 1 }
        : original(sql, values)
    );
    const invoke = () =>
      action === 'create'
        ? f.service.create({ ...input, profileId, serviceType: 'savings' }, actor, '127.0.0.1')
        : action === 'update'
          ? f.service.updateContract(
              id,
              { ...input, expectedVersionId: versionId },
              actor,
              '127.0.0.1'
            )
          : f.service.createAmendment(
              id,
              { ...input, expectedVersionId: versionId },
              actor,
              '127.0.0.1'
            );
    expect(await invoke()).toBe(saved);
    const kind =
      action === 'create'
        ? 'contract_create'
        : action === 'update'
          ? 'contract_update'
          : 'contract_amendment_create';
    const captured = { ...input, ...(action === 'create' ? {} : { contractId: id }) };
    expect(
      f.client.query.mock.calls.find(([sql]) => sql.includes("response->'request'"))?.[1]
    ).toEqual([kind, `${actor.userId}:${id}`, JSON.stringify(captured)]);
    expect(f.client.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [`${kind}:${actor.userId}:${id}`]
    );
    expect(h.stepUp).toHaveBeenCalledTimes(2);
    expect(h.permission.mock.calls.map((call) => call[2])).toEqual(['contracts:write']);
    expect(f.client.query.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(
      false
    );
    expect(f.get).not.toHaveBeenCalled();
    matches = false;
    await expect(invoke()).rejects.toMatchObject({ status: 409 });
    expect(f.client.query).toHaveBeenLastCalledWith('ROLLBACK');
  }
);
