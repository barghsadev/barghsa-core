import { HttpException } from '@nestjs/common';
import { beforeEach, expect, it, vi } from 'vitest';
import { SavingOrderService } from './saving-order.service.js';
import { SavingFulfillmentService } from './saving-fulfillment.service.js';
const h = vi.hoisted(() => ({
  connect: vi.fn(),
  target: vi.fn(),
  session: vi.fn(),
  review: vi.fn(),
  mutation: vi.fn(),
  idempotency: vi.fn(),
}));
vi.mock('@barghsa/db', () => ({ getDbPool: () => ({ connect: h.connect, query: h.target }) }));
vi.mock('../session/session-step-up.js', () => ({ requireCurrentSession: h.session }));
vi.mock('../contract/contract-transactions.js', () => ({
  staffContractFinancialReview: h.review,
  staffContractMutation: h.mutation,
  contractIdempotency: h.idempotency,
  auditContract: vi.fn(),
}));
const id = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const actor = { userId: 'opaque-customer', sessionId: id, csrfToken: 'csrf' };
beforeEach(() => {
  vi.resetAllMocks();
  h.session.mockResolvedValue(undefined);
});
function customerFixture() {
  let row: Record<string, unknown> | undefined = { id, profile_id: profileId, can_edit: true };
  const client = {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes('FROM saving_orders s') && row ? [row] : [],
    })),
    release: vi.fn(),
  };
  h.connect.mockResolvedValue(client);
  const orders = {
    lockOrderActor: vi.fn().mockResolvedValue(undefined),
    mayManageOrders: vi.fn().mockResolvedValue(true),
  };
  const service = new SavingOrderService(
    orders as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
  return {
    client,
    orders,
    service,
    row: (value: typeof row) => {
      row = value;
    },
  };
}
function noEffects(client: { query: ReturnType<typeof vi.fn> }) {
  for (const [sql] of client.query.mock.calls)
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|audit_log|notifications|idempotency/i);
  expect(h.idempotency).not.toHaveBeenCalled();
}
it('requires live customer actor and commercial owner/manager before final-session feedback without effects', async () => {
  const f = customerFixture();
  await f.service.assertCanChange(actor, id);
  expect(f.orders.lockOrderActor).toHaveBeenCalledWith(f.client, actor);
  expect(f.orders.mayManageOrders).toHaveBeenCalledWith(f.client, actor.userId, profileId, true);
  expect(h.session).toHaveBeenCalledWith(f.client, actor);
  expect(f.client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  expect(f.client.release).toHaveBeenCalledOnce();
  noEffects(f.client);
});
it('withdraws missing, foreign and no-longer-editable customer resources without effects', async () => {
  for (const denied of ['missing', 'foreign', 'ineligible']) {
    const f = customerFixture();
    if (denied === 'missing') f.row(undefined);
    if (denied === 'foreign') f.orders.mayManageOrders.mockResolvedValue(false);
    if (denied === 'ineligible') f.row({ id, profile_id: profileId, can_edit: false });
    await expect(f.service.assertCanChange(actor, id)).rejects.toMatchObject({
      status: denied === 'ineligible' ? 409 : 404,
    });
    expect(f.client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(f.client.release).toHaveBeenCalledOnce();
    noEffects(f.client);
  }
});
it('rolls back customer feedback when the current session expires after the authorized row read', async () => {
  const f = customerFixture();
  const denied = new HttpException('Expired session', 401);
  h.session.mockRejectedValueOnce(denied);
  await expect(f.service.assertCanChange(actor, id)).rejects.toBe(denied);
  expect(f.client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  noEffects(f.client);
});
function staffFixture() {
  h.target.mockResolvedValue({ rows: [{ profile_id: profileId }] });
  const client = { query: vi.fn().mockResolvedValue({ rows: [{ id }] }) };
  const wrapper = async (
    _profile: string,
    _actor: unknown,
    work: (client: unknown, archived: boolean) => Promise<void>
  ) => work(client, false);
  h.review.mockImplementation(wrapper);
  h.mutation.mockImplementation(wrapper);
  const service = new SavingFulfillmentService({} as never, {} as never, {} as never, {} as never);
  return { client, service };
}
it.each([false, true])(
  'reuses the exact staff financial authority wrapper for write=%s and share-reads the current resource',
  async (write) => {
    const f = staffFixture();
    await f.service.assertCanAmendAddress(id, actor, write);
    const used = write ? h.mutation : h.review;
    expect(used).toHaveBeenCalledWith(
      profileId,
      actor,
      expect.any(Function),
      ...(write ? [{ financialReview: true }] : [])
    );
    expect(write ? h.review : h.mutation).not.toHaveBeenCalled();
    expect(f.client.query).toHaveBeenCalledWith(expect.stringContaining('FOR SHARE OF s,o,c,i'), [
      id,
    ]);
    noEffects(f.client);
  }
);
it.each([false, true])(
  'preserves missing-resource, archived-profile and wrapper denial before staff feedback for write=%s',
  async (write) => {
    const f = staffFixture();
    h.target.mockResolvedValueOnce({ rows: [] });
    await expect(f.service.assertCanAmendAddress(id, actor, write)).rejects.toMatchObject({
      status: 404,
    });
    expect(h.review).not.toHaveBeenCalled();
    expect(h.mutation).not.toHaveBeenCalled();
    const used = write ? h.mutation : h.review;
    used.mockImplementationOnce(async (_profile, _actor, work) => work(f.client, true));
    await expect(f.service.assertCanAmendAddress(id, actor, write)).rejects.toMatchObject({
      status: 409,
    });
    expect(f.client.query).not.toHaveBeenCalled();
    for (const status of [401, 403]) {
      const denied = new HttpException('Live authority denied', status);
      used.mockRejectedValueOnce(denied);
      await expect(f.service.assertCanAmendAddress(id, actor, write)).rejects.toBe(denied);
    }
    f.client.query.mockResolvedValueOnce({ rows: [] });
    await expect(f.service.assertCanAmendAddress(id, actor, write)).rejects.toMatchObject({
      status: 404,
    });
    noEffects(f.client);
  }
);
