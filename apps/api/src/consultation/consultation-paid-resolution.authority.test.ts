import { HttpException } from '@nestjs/common';
import { beforeEach, expect, it, vi } from 'vitest';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
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
  invoiceId = '33333333-3333-4333-8333-333333333333';
const actor = { userId: 'currently-authorized-staff', sessionId: id, csrfToken: 'csrf' };
const contexts = [
  { recovery: false, write: false },
  { recovery: true, write: false },
  { recovery: false, write: true },
  { recovery: true, write: true },
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of [h.permission, h.current, h.stepUp, h.policy])
    mock.mockResolvedValue(undefined);
});
function fixture() {
  let source = true,
    present = true,
    moved = false;
  const client = {
    query: vi.fn<(sql: string) => Promise<{ rows: Record<string, unknown>[] }>>(
      async (sql: string) => ({
        rows: sql.startsWith('SELECT profile_id,invoice_id')
          ? source
            ? [{ profile_id: profileId, invoice_id: invoiceId }]
            : []
          : sql.includes('FROM consultation_requests r JOIN profiles')
            ? present
              ? [
                  {
                    id,
                    profile_id: moved ? id : profileId,
                    invoice_id: invoiceId,
                    status: 'completed',
                  },
                ]
              : []
            : sql.startsWith('SELECT id FROM invoices WHERE consultation_id')
              ? [{ id: invoiceId }]
              : [],
      })
    ),
    release: vi.fn(),
  };
  h.connect.mockResolvedValue(client);
  const transition = vi.fn(),
    adjust = vi.fn(),
    refund = vi.fn();
  const service = new ConsultationWorkflowService(
    {} as never,
    {} as never,
    {} as never,
    { transition } as never,
    { createAdjustmentInvoice: adjust } as never,
    { request: refund } as never
  );
  return {
    client,
    service,
    engines: [transition, adjust, refund],
    absent: () => {
      source = false;
    },
    missingLocked: () => {
      present = false;
    },
    moved: () => {
      moved = true;
    },
  };
}
function noEffects(f: ReturnType<typeof fixture>, replay = false) {
  for (const engine of f.engines) expect(engine).not.toHaveBeenCalled();
  for (const [sql] of f.client.query.mock.calls) {
    if (replay && sql.includes("'consultation.request.changed'")) continue;
    expect(sql).not.toMatch(
      /^(?:INSERT|UPDATE|DELETE)|refunds|consultation_request_events|in_app_notifications/
    );
  }
}
it.each(contexts)(
  'checks exact live resource, grants and lock order for recovery=$recovery/write=$write',
  async (context) => {
    const f = fixture();
    await f.service.assertCanEditPaidResolution(actor, id, context.recovery, context.write);
    expect(h.permission.mock.calls.map((call) => call[2])).toEqual([
      'orders:write',
      'admin:financial:edit',
      ...(!context.recovery ? ['invoices:write'] : []),
    ]);
    const session = context.write ? h.stepUp : h.current;
    expect(session).toHaveBeenCalledTimes(2);
    expect(session).toHaveBeenNthCalledWith(1, f.client, actor);
    expect(context.write ? h.current : h.stepUp).not.toHaveBeenCalled();
    expect(h.policy).toHaveBeenCalledWith(f.client, 'read');
    const sql = f.client.query.mock.calls.map((call) => call[0]);
    expect(sql.indexOf('SELECT id FROM profiles WHERE id=$1 FOR SHARE')).toBeLessThan(
      sql.indexOf('SELECT id FROM invoices WHERE id=$1 FOR UPDATE')
    );
    expect(sql.findIndex((value) => value.includes('FOR UPDATE OF r'))).toBeGreaterThan(
      sql.indexOf('SELECT id FROM invoices WHERE id=$1 FOR UPDATE')
    );
    expect(sql.at(-1)).toBe('COMMIT');
    expect(f.client.release).toHaveBeenCalledOnce();
    noEffects(f);
  }
);
it.each(contexts)(
  'withdraws missing or moved current resource for recovery=$recovery/write=$write',
  async (context) => {
    for (const [state, status] of [
      ['absent', 404],
      ['missingLocked', 404],
      ['moved', 409],
    ] as const) {
      const f = fixture();
      f[state]();
      await expect(
        f.service.assertCanEditPaidResolution(actor, id, context.recovery, context.write)
      ).rejects.toMatchObject({ status });
      expect(f.client.query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(f.client.release).toHaveBeenCalledOnce();
      noEffects(f);
    }
  }
);
it.each(contexts)(
  'retains permission and first/final session denial for recovery=$recovery/write=$write',
  async (context) => {
    const denied = new HttpException('Current authority', 403);
    for (const permission of [
      'orders:write',
      'admin:financial:edit',
      ...(!context.recovery ? ['invoices:write'] : []),
    ]) {
      const f = fixture();
      h.permission.mockImplementation(async (_client, _actor, field) => {
        if (field === permission) throw denied;
      });
      await expect(
        f.service.assertCanEditPaidResolution(actor, id, context.recovery, context.write)
      ).rejects.toBe(denied);
      expect(f.client.query).toHaveBeenLastCalledWith('ROLLBACK');
      noEffects(f);
    }
    h.permission.mockResolvedValue(undefined);
    for (const final of [false, true]) {
      const f = fixture(),
        session = context.write ? h.stepUp : h.current;
      if (final) session.mockResolvedValueOnce(undefined);
      session.mockRejectedValueOnce(denied);
      await expect(
        f.service.assertCanEditPaidResolution(actor, id, context.recovery, context.write)
      ).rejects.toBe(denied);
      expect(f.client.query).toHaveBeenLastCalledWith('ROLLBACK');
      noEffects(f);
    }
  }
);
it.each(['cancel', 'reject', 'recover_refund'] as const)(
  'returns original $0 receipt after refund progress under current authority',
  async (action) => {
    const f = fixture();
    const recovery = action === 'recover_refund';
    const review = new ReviewSnapshotService().create(
      { action: 'consultation.paid-resolution', profileId, resourceId: id },
      {
        action,
        serviceTitle: { en: 'Service', fa: 'خدمت' },
        profileName: 'Profile',
        currentStatus: 'offer_accepted',
        resultingStatus: recovery
          ? 'offer_accepted'
          : action === 'cancel'
            ? 'cancelled'
            : 'rejected',
        reason: 'Captured reason',
        currentInvoice: {
          id: invoiceId,
          state: 'Paid',
          paidAmount: '500000',
          adjustmentKind: null,
        },
        cancelInvoiceId: null,
        uncoveredCreditBefore: recovery ? '50000' : '0',
        refundAllocations: [
          {
            invoiceId,
            state: 'Paid',
            amount: recovery ? '50000' : '500000',
            availableBefore: '500000',
          },
        ],
        totalCredit: recovery ? '0' : '500000',
        totalRefund: recovery ? '50000' : '500000',
      }
    );
    const result = {
      requestId: id,
      status: review.data.resultingStatus,
      refundIds: [id],
      financialReview: review,
      ...(!recovery ? { cancelledInvoiceId: null, creditInvoiceIds: [profileId] } : {}),
    };
    const originalQuery = f.client.query.getMockImplementation()!;
    f.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT metadata::jsonb AS metadata'))
        return {
          rows: [
            { metadata: { action, reason: 'Captured reason', result, financialReview: review } },
          ],
        };
      if (sql.startsWith('SELECT status,staff_owner_id'))
        return { rows: [{ status: 'completed', staff_owner_id: null, staff_team: null }] };
      return originalQuery(sql);
    });
    const input = {
      idempotencyKey: id,
      reason: 'Captured reason',
      expectedReviewHash: review.hash,
    };
    expect(
      await (action === 'recover_refund'
        ? f.service.recoverRefund(actor, id, input, '127.0.0.1')
        : f.service.closePaid(actor, id, action, input, '127.0.0.1'))
    ).toEqual(result);
    expect(h.permission.mock.calls.map((call) => call[2])).toEqual([
      'orders:write',
      'admin:financial:edit',
    ]);
    expect(h.stepUp).toHaveBeenCalledTimes(2);
    noEffects(f, true);
  }
);
