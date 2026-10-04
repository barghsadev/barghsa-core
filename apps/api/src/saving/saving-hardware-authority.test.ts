import { HttpException } from '@nestjs/common';
import { beforeEach, expect, it, vi } from 'vitest';
import { SavingFulfillmentService } from './saving-fulfillment.service.js';

const h = vi.hoisted(() => ({
  target: vi.fn(),
  review: vi.fn(),
  mutation: vi.fn(),
  finance: vi.fn(),
  idempotency: vi.fn(),
}));
vi.mock('@barghsa/db', () => ({ getDbPool: () => ({ query: h.target }) }));
vi.mock('../admin/staff-mutation-permission.js', () => ({
  requireStaffMutationPermission: h.finance,
}));
vi.mock('../contract/contract-transactions.js', () => ({
  staffContractFinancialReview: h.review,
  staffContractMutation: h.mutation,
  contractIdempotency: h.idempotency,
  auditContract: vi.fn(),
}));
const id = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const targetId = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';
const contractId = '55555555-5555-4555-8555-555555555555';
const actor = { userId: 'opaque-staff', sessionId: id, csrfToken: 'csrf' };
beforeEach(() => {
  vi.resetAllMocks();
  h.finance.mockResolvedValue(undefined);
});
function fixture(price = '200') {
  h.target.mockResolvedValue({ rows: [{ profile_id: profileId }] });
  let present = true,
    upgrade = true,
    foreign = false;
  const client = {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes('FROM saving_orders s')
        ? present
          ? [
              {
                id,
                contract_id: contractId,
                hardware_product_id: id,
                saving_plan_id: profileId,
                pricing_snapshot: {
                  plan: { title: { en: 'Plan', fa: 'طرح' } },
                  lines: [
                    { type: 'plan_price', amountIrR: '100', vatRateBps: 0 },
                    { type: 'hardware_price', amountIrR: '200', vatRateBps: 0 },
                  ],
                  discountIrR: '0',
                  totalIrR: '300',
                },
              },
            ]
          : []
        : sql.includes('FROM saving_plan_hardware')
          ? [
              {
                id: targetId,
                title: { en: 'Device', fa: 'دستگاه' },
                price,
                vat_rate_bps: 0,
                stock_tracking: true,
                stock_count: 2,
                reserved_count: 0,
              },
            ]
          : sql.includes('SELECT adjustment_invoice_id')
            ? upgrade
              ? [{ adjustment_invoice_id: invoiceId }]
              : []
            : sql.includes('SELECT contract_id FROM saving_hardware_upgrade_requests')
              ? upgrade
                ? [{ contract_id: foreign ? targetId : contractId }]
                : []
              : sql.includes('FROM invoices')
                ? [{ id: invoiceId }]
                : [],
    })),
  };
  const access = async (
    _profile: string,
    _actor: unknown,
    work: (client: unknown, archived: boolean) => Promise<void>
  ) => work(client, false);
  h.review.mockImplementation(access);
  h.mutation.mockImplementation(access);
  const service = new SavingFulfillmentService({} as never, {} as never, {} as never, {} as never);
  return {
    client,
    service,
    missing: () => {
      present = false;
    },
    missingUpgrade: () => {
      upgrade = false;
    },
    foreignUpgrade: () => {
      foreign = true;
    },
  };
}
function noEffects(client: { query: ReturnType<typeof vi.fn> }) {
  for (const [sql] of client.query.mock.calls)
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b|audit_log|notifications|idempotency/i);
  expect(h.idempotency).not.toHaveBeenCalled();
}
function wrapper(write: boolean) {
  return write ? h.mutation : h.review;
}
function exactAccess(write: boolean) {
  expect(wrapper(write)).toHaveBeenCalledWith(
    profileId,
    actor,
    expect.any(Function),
    ...(write ? [{ financialReview: true }] : [])
  );
  expect(write ? h.review : h.mutation).not.toHaveBeenCalled();
}
it.each([false, true])(
  'permits contract-only equal-price or invalid-target feedback under the exact wrapper write=%s',
  async (write) => {
    const f = fixture();
    for (const hardwareProductId of [targetId, 'PRIVATE', null])
      await f.service.assertCanAmendHardware(id, actor, write, { hardwareProductId }, false);
    exactAccess(write);
    expect(h.finance).not.toHaveBeenCalled();
    expect(f.client.query).toHaveBeenCalledWith(expect.stringContaining('FOR SHARE OF s,o,c,i'), [
      id,
    ]);
    noEffects(f.client);
  }
);
it.each([false, true])(
  'rechecks live invoice authority for both charge and credit target feedback write=%s',
  async (write) => {
    for (const price of ['250', '150']) {
      const f = fixture(price);
      await f.service.assertCanAmendHardware(
        id,
        actor,
        write,
        { hardwareProductId: targetId },
        true
      );
      expect(h.finance).toHaveBeenLastCalledWith(f.client, actor.userId, 'invoices:write');
      exactAccess(write);
      noEffects(f.client);
    }
  }
);
it.each([false, true])(
  'preserves cached and revoked live finance denial for a nonzero target write=%s',
  async (write) => {
    const f = fixture('250');
    await expect(
      f.service.assertCanAmendHardware(id, actor, write, { hardwareProductId: targetId }, false)
    ).rejects.toMatchObject({ status: 403 });
    expect(h.finance).not.toHaveBeenCalled();
    const denied = new HttpException('Live finance revoked', 403);
    h.finance.mockRejectedValueOnce(denied);
    await expect(
      f.service.assertCanAmendHardware(id, actor, write, { hardwareProductId: targetId }, true)
    ).rejects.toBe(denied);
    noEffects(f.client);
  }
);
it.each([false, true])(
  'binds cancellation upgrade to this order and locks invoice before upgrade/order for write=%s',
  async (write) => {
    const f = fixture();
    await f.service.assertCanCancelHardwareUpgrade(id, actor, write, { upgradeId: targetId });
    exactAccess(write);
    expect(h.finance).toHaveBeenCalledWith(f.client, actor.userId, 'invoices:write');
    const calls = f.client.query.mock.calls;
    expect(calls[0]).toEqual([
      expect.stringContaining('WHERE id=$1 AND order_id=$2'),
      [targetId, id],
    ]);
    expect(calls[1]).toEqual(['SELECT id FROM invoices WHERE id=$1 FOR SHARE', [invoiceId]]);
    expect(calls[2]).toEqual([
      expect.stringContaining('adjustment_invoice_id=$3 FOR SHARE'),
      [targetId, id, invoiceId],
    ]);
    expect(calls[3]).toEqual([expect.stringContaining('FOR SHARE OF s,o,c,i'), [id]]);
    noEffects(f.client);
  }
);
it.each([false, true])(
  'rejects missing/foreign cancellation sources and live invoice denial without effects write=%s',
  async (write) => {
    const f = fixture();
    f.missingUpgrade();
    await expect(
      f.service.assertCanCancelHardwareUpgrade(id, actor, write, { upgradeId: targetId })
    ).rejects.toMatchObject({ status: 409 });
    const foreign = fixture();
    foreign.foreignUpgrade();
    await expect(
      foreign.service.assertCanCancelHardwareUpgrade(id, actor, write, { upgradeId: targetId })
    ).rejects.toMatchObject({ status: 409 });
    const revoked = fixture();
    const denied = new HttpException('Finance revoked', 403);
    h.finance.mockRejectedValueOnce(denied);
    await expect(
      revoked.service.assertCanCancelHardwareUpgrade(id, actor, write, { upgradeId: targetId })
    ).rejects.toBe(denied);
    expect(revoked.client.query).not.toHaveBeenCalled();
    for (const value of [f, foreign, revoked]) noEffects(value.client);
  }
);
it.each([false, true])(
  'preserves missing, archived and current session/contract wrapper withdrawal write=%s',
  async (write) => {
    for (const cancel of [false, true]) {
      const f = fixture();
      const invoke = () =>
        cancel
          ? f.service.assertCanCancelHardwareUpgrade(id, actor, write, { upgradeId: targetId })
          : f.service.assertCanAmendHardware(
              id,
              actor,
              write,
              { hardwareProductId: targetId },
              false
            );
      h.target.mockResolvedValueOnce({ rows: [] });
      await expect(invoke()).rejects.toMatchObject({ status: 404 });
      expect(wrapper(write)).not.toHaveBeenCalled();
      wrapper(write).mockImplementationOnce(async (_profile, _actor, work) => work(f.client, true));
      await expect(invoke()).rejects.toMatchObject({ status: 409 });
      expect(f.client.query).not.toHaveBeenCalled();
      for (const status of [401, 403]) {
        const denied = new HttpException('Current authority', status);
        wrapper(write).mockRejectedValueOnce(denied);
        await expect(invoke()).rejects.toBe(denied);
      }
      f.missing();
      await expect(invoke()).rejects.toMatchObject({ status: 404 });
      noEffects(f.client);
      vi.clearAllMocks();
    }
  }
);
