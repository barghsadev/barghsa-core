import { HttpException } from '@nestjs/common';
import { beforeEach, expect, it, vi } from 'vitest';
import type * as DbModule from '@barghsa/db';
import { ContractSignatureService } from './contract-signature.service.js';
import { ContractReviewService } from './contract-review.service.js';
import { activeProfileSql } from '../profiles/profile-context.js';

const h = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  permission: vi.fn(),
  current: vi.fn(),
  stepUp: vi.fn(),
}));
vi.mock('@barghsa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getDbPool: () => ({ connect: h.connect, query: h.query }),
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
const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const actor = { userId: 'opaque-account', sessionId: id, csrfToken: 'current-csrf' };
const contexts = [
  { staff: true, write: false },
  { staff: true, write: true },
  { staff: false, write: false },
  { staff: false, write: true },
];
beforeEach(() => {
  vi.resetAllMocks();
  for (const fn of [h.permission, h.current, h.stepUp]) fn.mockResolvedValue(undefined);
});
function fixture() {
  const state = {
    identity: true,
    profile: true,
    archived: false,
    selected: true,
    account: true,
    disabled: false,
    parent: true,
    published: true,
    currentVersion: versionId,
    status: 'AwaitingSignature',
    request: true,
    requestId,
    documentState: 'Approved',
    signed: false,
    amendment: false,
    activeCalls: 0,
    failSelectedAt: 0,
  };
  const order: string[] = [];
  const client = {
    query: vi.fn<
      (
        sql: string,
        values?: unknown[]
      ) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number }>
    >(async (sql, values) => {
      order.push(sql);
      let rows: Record<string, unknown>[] = [];
      if (sql.startsWith('SELECT p.id,')) {
        state.activeCalls++;
        rows =
          state.selected && state.activeCalls !== state.failSelectedAt ? [{ id: profileId }] : [];
      } else if (sql.includes('FROM profiles WHERE'))
        rows = state.profile ? [{ archived: state.archived }] : [];
      else if (sql.includes('FROM users WHERE'))
        rows = state.account
          ? [{ disabled_at: state.disabled ? new Date() : null, activation_token: null }]
          : [];
      else if (sql.includes('FROM contracts WHERE'))
        rows =
          state.parent &&
          values?.[0] === id &&
          (values?.[1] === undefined || values?.[1] === profileId)
            ? [
                {
                  id,
                  profile_id: profileId,
                  current_version_id: state.currentVersion,
                  state: state.status,
                  signed_at: state.signed ? new Date() : null,
                },
              ]
            : [];
      else if (sql.includes('FROM contract_versions'))
        rows = state.published && values?.[1] === versionId ? [{ id: versionId }] : [];
      else if (sql.includes('FROM contract_amendments'))
        rows = state.amendment ? [{ valid: true }] : [];
      else if (sql.includes('FROM contract_signature_requests'))
        rows = state.request
          ? [
              {
                id: state.requestId,
                request_number: 1,
                original_document_id: profileId,
                original_name: 'Approved terms.pdf',
                document_state: state.documentState,
                requested_by: actor.userId,
                requested_at: new Date('2026-10-05T00:00:00.000Z'),
              },
            ]
          : [];
      else if (sql.includes('FROM contract_signatures'))
        rows = state.signed
          ? [
              {
                request_id: requestId,
                signed_document_id: id,
                original_name: 'Signed image.png',
                document_state: 'Approved',
                recorded_by: actor.userId,
                recorded_by_type: 'customer',
                uploaded_by: actor.userId,
                uploaded_by_type: 'customer',
                recorded_at: new Date('2026-10-05T00:00:01.000Z'),
              },
            ]
          : [];
      return { rows, rowCount: rows.length };
    }),
    release: vi.fn(),
  };
  h.query.mockImplementation(async () => ({
    rows: state.identity ? [{ profile_id: profileId }] : [],
  }));
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
  const get = vi.fn();
  return {
    state,
    order,
    client,
    get,
    signature: new ContractSignatureService(),
    review: new ContractReviewService({ get } as never),
  };
}
function noEffects(f: ReturnType<typeof fixture>) {
  expect(f.get).not.toHaveBeenCalled();
  for (const [sql] of f.client.query.mock.calls)
    expect(sql).not.toMatch(
      /^(INSERT|UPDATE|DELETE)|pg_advisory|idempotency_keys|audit_log|notifications/
    );
}
it.each(contexts)(
  'signing preflight preserves grants/profile-first locks and session checks %j',
  async ({ staff, write }) => {
    const f = fixture();
    await f.signature.assertCanSelectDocument(
      id,
      { action: 'record', versionId, requestId },
      actor,
      staff,
      write
    );
    expect(f.order[0]).toBe('BEGIN');
    if (staff) {
      expect(f.order[1]).toBe('SELECT archived FROM profiles WHERE id=$1 FOR UPDATE');
      expect(h.permission.mock.calls.map((call) => call[2])).toEqual(['contracts:write']);
    } else {
      expect(f.client.query).toHaveBeenCalledWith(activeProfileSql('contracts:sign'), [
        actor.userId,
      ]);
      expect(f.order.findIndex((sql) => sql.includes('FROM profiles WHERE'))).toBeLessThan(
        f.order.findIndex((sql) => sql.includes('FROM contracts WHERE'))
      );
      expect(h.permission).not.toHaveBeenCalled();
    }
    expect(
      f.client.query.mock.calls.find(([sql]) => sql.includes('FROM contracts WHERE'))?.[0]
    ).toContain(write ? ' FOR UPDATE' : ' FOR SHARE');
    const session = write ? h.stepUp : h.current;
    expect(session).toHaveBeenCalledTimes(2);
    expect(write ? h.current : h.stepUp).not.toHaveBeenCalled();
    expect(f.order.at(-1)).toBe('COMMIT');
    expect(f.client.release).toHaveBeenCalledOnce();
    noEffects(f);
  }
);
it.each(contexts)(
  'signing feedback withdraws missing/private/stale/closed source %j',
  async ({ staff, write }) => {
    for (const [patch, status] of [
      [{ identity: false }, 404],
      [{ profile: false }, 404],
      [{ archived: true }, staff ? 409 : 404],
      [{ parent: false }, 404],
      [{ published: false }, 404],
      [{ currentVersion: id }, 409],
      [{ requestId: id }, 409],
      [{ documentState: 'Quarantined' }, 409],
      [{ status: 'Active' }, 409],
      [{ signed: true }, 409],
    ] as const) {
      if (!staff && 'identity' in patch) continue;
      const f = fixture();
      Object.assign(f.state, patch);
      await expect(
        f.signature.assertCanSelectDocument(
          id,
          { action: 'record', versionId, requestId },
          actor,
          staff,
          write
        )
      ).rejects.toMatchObject({ status });
      if (h.connect.mock.calls.length) expect(f.client.query).toHaveBeenLastCalledWith('ROLLBACK');
      noEffects(f);
    }
  }
);
it.each(contexts)(
  'signing feedback preserves revoked current authority and final rechecks %j',
  async ({ staff, write }) => {
    const denied = new HttpException('Revoked current authority', 403);
    if (staff) {
      const f = fixture();
      h.permission.mockRejectedValueOnce(denied);
      await expect(
        f.signature.assertCanSelectDocument(
          id,
          { action: 'record', versionId, requestId },
          actor,
          staff,
          write
        )
      ).rejects.toBe(denied);
      noEffects(f);
    } else
      for (const at of [1, 2, 3]) {
        const f = fixture();
        f.state.failSelectedAt = at;
        await expect(
          f.signature.assertCanSelectDocument(
            id,
            { action: 'record', versionId, requestId },
            actor,
            staff,
            write
          )
        ).rejects.toMatchObject({ status: 404 });
        noEffects(f);
      }
    for (const final of [false, true]) {
      const f = fixture(),
        session = write ? h.stepUp : h.current;
      if (final) session.mockResolvedValueOnce(undefined);
      session.mockRejectedValueOnce(denied);
      await expect(
        f.signature.assertCanSelectDocument(
          id,
          { action: 'record', versionId, requestId },
          actor,
          staff,
          write
        )
      ).rejects.toBe(denied);
      expect(f.client.query).toHaveBeenLastCalledWith('ROLLBACK');
      noEffects(f);
    }
    if (!staff) {
      const f = fixture();
      f.state.disabled = true;
      await expect(
        f.signature.assertCanSelectDocument(
          id,
          { action: 'record', versionId, requestId },
          actor,
          staff,
          write
        )
      ).rejects.toMatchObject({ status: 401 });
      noEffects(f);
    }
  }
);
it.each([false, true])(
  'allows original/amendment request and signed selection in their current scope write=%s',
  async (write) => {
    const f = fixture();
    f.state.request = false;
    f.state.status = 'Accepted';
    await f.signature.assertCanSelectDocument(
      id,
      { action: 'request', versionId, requestId: null },
      actor,
      true,
      write
    );
    f.state.status = 'Active';
    f.state.currentVersion = id;
    f.state.amendment = true;
    await f.signature.assertCanSelectDocument(
      id,
      { action: 'request', versionId, requestId: null },
      actor,
      true,
      write
    );
    f.state.request = true;
    await f.signature.assertCanSelectDocument(
      id,
      { action: 'record', versionId, requestId },
      actor,
      false,
      write
    );
    noEffects(f);
  }
);
it('customer request-action owned input stays private before database access', async () => {
  const f = fixture();
  for (const write of [false, true])
    await expect(
      f.signature.assertCanSelectDocument(
        id,
        { action: 'request', versionId, requestId: null },
        actor,
        false,
        write
      )
    ).rejects.toMatchObject({ status: 404 });
  expect(h.query).not.toHaveBeenCalled();
  expect(h.connect).not.toHaveBeenCalled();
  noEffects(f);
});
it('malformed protected route/version/request identifiers never reach SQL', async () => {
  const f = fixture();
  for (const [contract, version, request] of [
    ['PRIVATE', versionId, requestId],
    [id, 'PRIVATE', requestId],
    [id, versionId, 'PRIVATE'],
  ])
    await expect(
      f.signature.assertCanSelectDocument(
        contract!,
        { action: 'record', versionId: version!, requestId: request! },
        actor,
        true,
        true
      )
    ).rejects.toMatchObject({ status: 404 });
  await expect(f.review.assertCanRequestChanges('PRIVATE', versionId, actor)).rejects.toMatchObject(
    { status: 404 }
  );
  expect(h.query).not.toHaveBeenCalled();
  expect(h.connect).not.toHaveBeenCalled();
  noEffects(f);
});
it('request-changes preflight retains nonfinancial profile SHARE and current expected review source', async () => {
  const f = fixture();
  f.state.status = 'AwaitingStaffReview';
  await f.review.assertCanRequestChanges(id, versionId, actor);
  expect(f.order.slice(0, 4)).toEqual([
    'BEGIN',
    'SELECT archived FROM profiles WHERE id=$1 FOR SHARE',
    'contracts:write',
    'stepUp',
  ]);
  expect(
    f.client.query.mock.calls.find(([sql]) => sql.includes('FROM contracts WHERE'))?.[0]
  ).toContain('WHERE id=$1 AND profile_id=$2 FOR UPDATE');
  expect(h.permission.mock.calls.map((call) => call[2])).toEqual(['contracts:write']);
  expect(h.stepUp).toHaveBeenCalledTimes(2);
  expect(h.current).not.toHaveBeenCalled();
  noEffects(f);
});
it('request-changes current grants/session/archive/version/eligibility override feedback', async () => {
  for (const [patch, status] of [
    [{ identity: false }, 404],
    [{ parent: false }, 404],
    [{ archived: true }, 409],
    [{ currentVersion: id }, 409],
    [{ status: 'Draft' }, 409],
  ] as const) {
    const f = fixture();
    f.state.status = 'AwaitingStaffReview';
    Object.assign(f.state, patch);
    await expect(f.review.assertCanRequestChanges(id, versionId, actor)).rejects.toMatchObject({
      status,
    });
    noEffects(f);
  }
  for (const boundary of ['permission', 'initial', 'final']) {
    const f = fixture();
    f.state.status = 'AwaitingStaffReview';
    const denied = new HttpException('Current denied', 403);
    if (boundary === 'permission') h.permission.mockRejectedValueOnce(denied);
    else {
      if (boundary === 'final') h.stepUp.mockResolvedValueOnce(undefined);
      h.stepUp.mockRejectedValueOnce(denied);
    }
    await expect(f.review.assertCanRequestChanges(id, versionId, actor)).rejects.toBe(denied);
    expect(f.client.query).toHaveBeenLastCalledWith('ROLLBACK');
    noEffects(f);
  }
});
it.each(['changes', 'request', 'staff-record', 'customer-record'] as const)(
  '%s returns exact actor-key/full-command stored receipt before new eligibility and rejects altered replay',
  async (kind) => {
    const f = fixture();
    f.state.status = 'Active';
    f.state.currentVersion = id;
    f.state.signed = true;
    const input = {
      expectedVersionId: versionId,
      idempotencyKey: id,
      ...(kind === 'changes'
        ? { reason: 'Captured correction' }
        : {
            expectedReviewHash: 'a'.repeat(64),
            ...(kind === 'request'
              ? { originalDocumentId: profileId, expectedRequestId: null }
              : { requestId, signedDocumentId: profileId }),
          }),
    };
    const result = { contractId: id, versionId, original: 'durable original receipt' };
    const original = f.client.query.getMockImplementation()!;
    let matches = true;
    f.client.query.mockImplementation(async (sql, values) =>
      sql.includes("response->'request'") ? { rows: [{ matches, result }] } : original(sql, values)
    );
    const invoke = () =>
      kind === 'changes'
        ? f.review.act(id, 'request-changes', input, actor, '127.0.0.1')
        : kind === 'request'
          ? f.signature.request(
              id,
              { ...input, originalDocumentId: profileId, expectedRequestId: null },
              actor,
              '127.0.0.1'
            )
          : f.signature.record(
              id,
              { ...input, requestId, signedDocumentId: profileId },
              actor,
              '127.0.0.1',
              kind === 'staff-record'
            );
    expect(await invoke()).toBe(result);
    const entity =
      kind === 'changes'
        ? 'contract_review'
        : kind === 'request'
          ? 'contract_signature_request'
          : 'contract_signature_record';
    const captured = {
      ...input,
      contractId: id,
      ...(kind === 'changes'
        ? { action: 'request-changes' }
        : kind === 'request'
          ? {}
          : { staff: kind === 'staff-record' }),
    };
    expect(
      f.client.query.mock.calls.find(([sql]) => sql.includes("response->'request'"))?.[1]
    ).toEqual([entity, `${actor.userId}:${id}`, JSON.stringify(captured)]);
    expect(f.client.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [`${entity}:${actor.userId}:${id}`]
    );
    expect(h.stepUp).toHaveBeenCalledTimes(2);
    expect(f.client.query.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(
      false
    );
    expect(f.get).not.toHaveBeenCalled();
    matches = false;
    await expect(invoke()).rejects.toMatchObject({ status: 409 });
    expect(f.client.query).toHaveBeenLastCalledWith('ROLLBACK');
  }
);
