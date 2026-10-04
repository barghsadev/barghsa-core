import { HttpException } from '@nestjs/common';
import { beforeEach, expect, it, vi } from 'vitest';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
import {
  consultationFeeCommand,
  replayConsultationFee,
  replayConsultationPaidFee,
} from './consultation-fee-replay.js';
import { consultationOfferDeadline } from './consultation-fee-input-fields.js';
import { ConsultationWorkflowService } from './consultation-workflow.service.js';

const h = vi.hoisted(() => ({
  connect: vi.fn(),
  permission: vi.fn(),
  current: vi.fn(),
  stepUp: vi.fn(),
  policy: vi.fn(),
}));
vi.mock('@barghsa/db', () => ({ getDbPool: () => ({ connect: h.connect }) }));
vi.mock('../admin/staff-mutation-permission.js', () => ({
  requireStaffMutationPermission: h.permission,
}));
vi.mock('../session/session-step-up.js', () => ({
  requireCurrentSession: h.current,
  requireSessionStepUp: h.stepUp,
}));
vi.mock('../admin/dual-approval-threshold-lock.js', () => ({
  lockDualApprovalThreshold: h.policy,
}));
const id = '11111111-1111-4111-8111-111111111111',
  profileId = '22222222-2222-4222-8222-222222222222',
  invoiceId = '33333333-3333-4333-8333-333333333333',
  originalId = '44444444-4444-4444-8444-444444444444',
  refundId = '55555555-5555-4555-8555-555555555555';
const actor = { userId: 'opaque-staff', sessionId: id, csrfToken: 'csrf' };
const contexts = [
  { name: 'ordinary preview', paid: false, write: false },
  { name: 'ordinary write', paid: false, write: true },
  { name: 'paid preview', paid: true, write: false },
  { name: 'paid write', paid: true, write: true },
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of [h.permission, h.current, h.stepUp, h.policy])
    mock.mockResolvedValue(undefined);
});
function stored(paid: boolean, credit = false) {
  const input = {
    idempotencyKey: id,
    fee: credit ? '450000' : '600000',
    scope: 'Scope',
    deliverables: 'Deliverables',
    reason: paid ? 'Revision' : undefined,
    validUntil: '2020-01-01T03:04:05+03:00',
  };
  const scope = {
    action: paid ? 'consultation.paid-fee-adjustment' : 'consultation.fee-offer',
    profileId,
    resourceId: id,
  };
  const financialReview = new ReviewSnapshotService().create(
    scope,
    paid
      ? {
          serviceTitle: { en: 'Service', fa: 'خدمت' },
          profileName: 'Profile',
          scope: input.scope,
          deliverables: input.deliverables,
          previousFee: '500000',
          revisedFee: input.fee,
          difference: credit ? '-50000' : '100000',
          adjustmentAmount: credit ? '50000' : '100000',
          reason: input.reason,
          validUntil: new Date(input.validUntil).toISOString(),
          paidInvoice: {
            id: originalId,
            state: 'Paid',
            totalAmount: '500000',
            paidAmount: '500000',
          },
          refundPlan: credit
            ? [{ invoiceId: originalId, amount: '50000', availableBefore: '500000' }]
            : [],
          outcome: credit ? 'credit_and_wallet_refund' : 'charge_invoice',
        }
      : {
          serviceTitle: { en: 'Service', fa: 'خدمت' },
          profileName: 'Profile',
          scope: input.scope,
          deliverables: input.deliverables,
          fee: input.fee,
          validUntil: new Date(input.validUntil).toISOString(),
          reason: null,
          previousInvoice: null,
          outcome: 'issue_invoice',
        }
  );
  const result = paid
    ? {
        requestId: id,
        status: credit ? 'offer_accepted' : 'offer_pending',
        invoiceId: credit ? originalId : invoiceId,
        adjustmentInvoiceId: invoiceId,
        refundIds: credit ? [refundId] : [],
        financialReview,
      }
    : { requestId: id, status: 'offer_pending', invoiceId, financialReview };
  const metadata = paid
    ? {
        fee: input.fee,
        reason: input.reason,
        validUntil: new Date(input.validUntil).toISOString(),
        financialReview,
        result,
      }
    : { financialReview, command: consultationFeeCommand(input), result };
  return {
    input: {
      ...input,
      reason: paid ? 'Revision' : undefined,
      expectedReviewHash: financialReview.hash,
    },
    metadata,
    result,
    financialReview,
  };
}
function fixture(paid = false, credit = false) {
  const saved = stored(paid, credit);
  let source = true,
    present = true,
    owner = actor.userId,
    proofs = 1,
    invoiceProofs = 1,
    missingProof = false;
  const client = {
    query: vi.fn(async (sql: string) => ({
      rows: sql.startsWith('SELECT profile_id,invoice_id')
        ? source
          ? [{ profile_id: profileId, invoice_id: invoiceId }]
          : []
        : sql.includes('FROM consultation_requests r JOIN profiles')
          ? present
            ? [
                {
                  id,
                  profile_id: profileId,
                  invoice_id: invoiceId,
                  status: 'completed',
                  fee: '999999',
                  scope: 'New scope',
                  deliverables: 'New deliverables',
                },
              ]
            : []
          : sql.includes("metadata->>'idempotencyKey'")
            ? Array.from({ length: invoiceProofs }, () => ({ id: invoiceId }))
            : sql.includes('SELECT user_id,metadata')
              ? missingProof
                ? []
                : Array.from({ length: proofs }, () => ({
                    user_id: owner,
                    metadata: saved.metadata,
                  }))
              : sql.startsWith('SELECT id FROM invoices WHERE consultation_id')
                ? [{ id: originalId }, { id: invoiceId }]
                : sql.startsWith('SELECT status,staff_owner_id')
                  ? [{ status: 'completed', staff_owner_id: null, staff_team: null }]
                  : [],
    })),
    release: vi.fn(),
  };
  h.connect.mockResolvedValue(client);
  const manual = { createManualInvoice: vi.fn() },
    replace = { cancelAndReplaceInvoice: vi.fn() },
    adjust = { createAdjustmentInvoice: vi.fn() },
    refund = { request: vi.fn() };
  const service = new ConsultationWorkflowService(
    {} as never,
    manual as never,
    replace as never,
    {} as never,
    adjust as never,
    refund as never
  );
  return {
    saved,
    client,
    service,
    engines: [
      manual.createManualInvoice,
      replace.cancelAndReplaceInvoice,
      adjust.createAdjustmentInvoice,
      refund.request,
    ],
    absent: () => {
      source = false;
    },
    missingLocked: () => {
      present = false;
    },
    foreign: () => {
      owner = 'other-authorized-staff';
    },
    ambiguous: () => {
      proofs = 2;
    },
    ambiguousInvoice: () => {
      invoiceProofs = 2;
    },
    noProof: () => {
      missingProof = true;
    },
    noKey: () => {
      invoiceProofs = 0;
      missingProof = true;
    },
  };
}
function noFinancialEffects(f: ReturnType<typeof fixture>, genericAudit = false) {
  for (const engine of f.engines) expect(engine).not.toHaveBeenCalled();
  for (const [sql] of f.client.query.mock.calls) {
    if (genericAudit && sql.includes("'consultation.request.changed'")) continue;
    expect(sql).not.toMatch(
      /^(?:INSERT|UPDATE|DELETE)|in_app_notifications|refunds|consultation_request_events/
    );
  }
}
it.each(contexts)(
  'keeps exact current resource/grants/session/lock order and final check without effects at $name',
  async (context) => {
    const f = fixture(context.paid);
    await f.service.assertCanEditFee(actor, id, context.paid, context.write);
    expect(h.permission.mock.calls.map((call) => call[2])).toEqual(
      context.paid
        ? ['orders:write', 'admin:financial:edit', 'invoices:write']
        : ['orders:write', 'invoices:write']
    );
    expect(context.write ? h.stepUp : h.current).toHaveBeenCalledTimes(2);
    expect(context.write ? h.current : h.stepUp).not.toHaveBeenCalled();
    if (context.paid) expect(h.policy).toHaveBeenCalledWith(f.client, 'read');
    else expect(h.policy).not.toHaveBeenCalled();
    const queries = f.client.query.mock.calls.map((call) => call[0]);
    expect(queries.indexOf('SELECT id FROM profiles WHERE id=$1 FOR SHARE')).toBeLessThan(
      queries.indexOf('SELECT id FROM invoices WHERE id=$1 FOR UPDATE')
    );
    expect(queries.indexOf('SELECT id FROM invoices WHERE id=$1 FOR UPDATE')).toBeLessThan(
      queries.findIndex((sql) => sql.includes('FOR UPDATE OF r'))
    );
    expect(queries.at(-1)).toBe('COMMIT');
    expect(f.client.release).toHaveBeenCalledOnce();
    noFinancialEffects(f);
  }
);
it.each(contexts)(
  'withdraws missing/current and final denied scope before owned input at $name',
  async (context) => {
    const f = fixture(context.paid);
    f.absent();
    await expect(
      f.service.assertCanEditFee(actor, id, context.paid, context.write)
    ).rejects.toMatchObject({ status: 404 });
    expect(h.permission).not.toHaveBeenCalled();
    const locked = fixture(context.paid);
    locked.missingLocked();
    await expect(
      locked.service.assertCanEditFee(actor, id, context.paid, context.write)
    ).rejects.toMatchObject({ status: 404 });
    const active = fixture(context.paid),
      check = context.write ? h.stepUp : h.current;
    for (const status of [401, 403]) {
      const denial = new HttpException('Current authority', status);
      check.mockRejectedValueOnce(denial);
      await expect(
        active.service.assertCanEditFee(actor, id, context.paid, context.write)
      ).rejects.toBe(denial);
      check.mockResolvedValueOnce(undefined).mockRejectedValueOnce(denial);
      await expect(
        active.service.assertCanEditFee(actor, id, context.paid, context.write)
      ).rejects.toBe(denial);
    }
    for (const value of [f, locked, active]) noFinancialEffects(value);
  }
);
it.each([false, true])(
  'returns original bound expired/paid-progress receipt with only the existing generic wrapper audit paid=%s',
  async (paid) => {
    const f = fixture(paid),
      input = { ...f.saved.input, reason: paid ? 'Revision' : undefined };
    const value = paid
      ? await f.service.adjustPaidFee(actor, id, { ...input, reason: 'Revision' }, 'ip')
      : await f.service.setFee(actor, id, input, 'ip');
    expect(value).toEqual(f.saved.result);
    noFinancialEffects(f, true);
    const audit = f.client.query.mock.calls.find((call) =>
      call[0].includes("'consultation.request.changed'")
    );
    expect(audit).toBeDefined();
    expect(h.permission).toHaveBeenCalledWith(f.client, actor.userId, 'invoices:write');
    expect(h.stepUp).toHaveBeenCalled();
    expect(
      f.client.query.mock.calls.some(([sql]) =>
        /paid_amount>0|SELECT fee,scope,deliverables/.test(sql)
      )
    ).toBe(false);
  }
);
it.each([false, true])(
  'rejects foreign actors, ambiguous or missing stored proof and altered hash/body before new effects paid=%s',
  async (paid) => {
    for (const variation of [
      'foreign',
      'ambiguous',
      'hash',
      'fee',
      'reason',
      'deadline',
      ...(paid ? [] : ['ambiguousInvoice', 'noProof']),
    ]) {
      const f = fixture(paid);
      const input = { ...f.saved.input, reason: paid ? 'Revision' : undefined };
      if (variation === 'foreign') f.foreign();
      if (variation === 'ambiguous') f.ambiguous();
      if (variation === 'ambiguousInvoice') f.ambiguousInvoice();
      if (variation === 'noProof') f.noProof();
      if (variation === 'hash') input.expectedReviewHash = 'a'.repeat(64);
      if (variation === 'fee') input.fee = '600001';
      if (variation === 'reason') input.reason = 'Changed';
      if (variation === 'deadline') input.validUntil = '2020-01-02T00:00:00Z';
      const invoke = paid
        ? f.service.adjustPaidFee(actor, id, { ...input, reason: input.reason ?? 'Revision' }, 'ip')
        : f.service.setFee(actor, id, input, 'ip');
      await expect(invoke).rejects.toMatchObject({ status: 409 });
      noFinancialEffects(f);
    }
  }
);
it.each([false, true])(
  'preserves current invoice grant/step-up rejection and new-write expired feedback paid=%s',
  async (paid) => {
    const f = fixture(paid);
    const invoke = () =>
      paid
        ? f.service.adjustPaidFee(actor, id, { ...f.saved.input, reason: 'Revision' }, 'ip')
        : f.service.setFee(actor, id, f.saved.input, 'ip');
    const denied = new HttpException('Invoice authority', 403);
    h.permission.mockImplementationOnce(async () => {
      throw denied;
    });
    await expect(invoke()).rejects.toBe(denied);
    noFinancialEffects(f);
    h.stepUp.mockRejectedValueOnce(denied);
    await expect(invoke()).rejects.toBe(denied);
    noFinancialEffects(f);
    f.noKey();
    await expect(invoke()).rejects.toMatchObject({ fields: ['validUntil'], status: 400 });
    noFinancialEffects(f);
  }
);
it('accepts legacy complete ordinary evidence and rejects changed terms, hidden reason or malformed/impossible receipt', () => {
  const f = stored(false);
  expect(
    replayConsultationFee({ financialReview: f.financialReview }, invoiceId, profileId, id, f.input)
  ).toEqual(f.result);
  for (const field of ['scope', 'deliverables'])
    expect(() =>
      replayConsultationFee(f.metadata, invoiceId, profileId, id, {
        ...f.input,
        [field]: 'Changed',
      })
    ).toThrow(HttpException);
  expect(() =>
    replayConsultationFee({ financialReview: f.financialReview }, invoiceId, profileId, id, {
      ...f.input,
      reason: 'Unproven legacy reason',
    })
  ).toThrow(HttpException);
  for (const result of [
    { ...f.result, status: 'offer_accepted' },
    { ...f.result, invoiceId: originalId },
    { ...f.result, financialReview: { ...f.financialReview, data: { changed: true } } },
    null,
  ])
    expect(() =>
      replayConsultationFee({ ...f.metadata, result }, invoiceId, profileId, id, f.input)
    ).toThrow(HttpException);
});
it.each([false, true])(
  'validates complete stored charge/credit receipts and immutable full review credit=%s',
  (credit) => {
    const f = stored(true, credit),
      input = { ...f.input, reason: 'Revision' };
    expect(replayConsultationPaidFee(f.metadata, profileId, id, input)).toEqual(f.result);
    for (const result of [
      null,
      { ...f.result, requestId: profileId },
      { ...f.result, adjustmentInvoiceId: originalId },
      { ...f.result, refundIds: [refundId, refundId] },
      { ...f.result, status: credit ? 'offer_pending' : 'offer_accepted' },
      { ...f.result, financialReview: { ...f.financialReview, data: { changed: true } } },
    ])
      expect(() =>
        replayConsultationPaidFee({ ...f.metadata, result }, profileId, id, input)
      ).toThrow(HttpException);
  }
);
it('uses explicit validUntil identity and exact future milliseconds without message classification', () => {
  expect(() => consultationOfferDeadline('2020-01-01T00:00:00Z')).toThrow(HttpException);
  expect(() => consultationOfferDeadline('PRIVATE')).toThrow(HttpException);
  expect(consultationOfferDeadline('2050-01-01T03:04:05.678+03:00').toISOString()).toBe(
    '2050-01-01T00:04:05.678Z'
  );
});
