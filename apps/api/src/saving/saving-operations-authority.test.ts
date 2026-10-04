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
const actor = { userId: 'opaque-staff', sessionId: id, csrfToken: 'csrf' };
const contexts = [
  { name: 'decision preview', write: false, fulfillment: false },
  { name: 'decision mutation', write: true, fulfillment: false },
  { name: 'stage preview', write: false, fulfillment: true },
  { name: 'stage mutation', write: true, fulfillment: true },
] as const;
beforeEach(() => vi.resetAllMocks());
function fixture(context: (typeof contexts)[number]) {
  h.target.mockResolvedValue({ rows: [{ profile_id: profileId }] });
  let present = true;
  const client = {
    query: vi.fn(async () => ({
      rows: present ? [{ id, status: 'completed', invoice_state: 'Cancelled' }] : [],
    })),
  };
  const wrapper = context.write ? h.mutation : h.review;
  wrapper.mockImplementation(async (_profile, _actor, work) => work(client, false));
  const service = new SavingFulfillmentService({} as never, {} as never, {} as never, {} as never);
  return {
    client,
    wrapper,
    invoke: () => service.assertCanDecideOrAdvance(id, actor, context.write, context.fulfillment),
    missing: () => {
      present = false;
    },
  };
}
function noEffects(client: { query: ReturnType<typeof vi.fn> }) {
  for (const [sql] of client.query.mock.calls)
    expect(sql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE)\b|audit_log|notifications|idempotency|saving_fulfillment_stages|saving_hardware_upgrade_requests/i
    );
  expect(h.idempotency).not.toHaveBeenCalled();
  expect(h.finance).not.toHaveBeenCalled();
}
it.each(contexts)(
  'binds current selected resource with the original wrapper and no business/finance checks at $name',
  async (context) => {
    const f = fixture(context);
    await f.invoke();
    expect(h.target).toHaveBeenCalledWith('SELECT profile_id FROM saving_orders WHERE id=$1', [id]);
    expect(f.wrapper).toHaveBeenCalledWith(
      profileId,
      actor,
      expect.any(Function),
      ...(context.write && context.fulfillment ? [{ financialReview: true }] : [])
    );
    expect(context.write ? h.review : h.mutation).not.toHaveBeenCalled();
    expect(f.client.query).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('WHERE s.id=$1 FOR SHARE OF s,o,c,i'),
      [id]
    );
    noEffects(f.client);
  }
);
it.each(contexts)(
  'withdraws missing initial/locked resource and archived profile without any effects at $name',
  async (context) => {
    const f = fixture(context);
    h.target.mockResolvedValueOnce({ rows: [] });
    await expect(f.invoke()).rejects.toMatchObject({ status: 404 });
    expect(f.wrapper).not.toHaveBeenCalled();
    f.wrapper.mockImplementationOnce(async (_profile, _actor, work) => work(f.client, true));
    await expect(f.invoke()).rejects.toMatchObject({ status: 409 });
    expect(f.client.query).not.toHaveBeenCalled();
    f.missing();
    await expect(f.invoke()).rejects.toMatchObject({ status: 404 });
    noEffects(f.client);
  }
);
it.each(contexts)(
  'preserves current/final session, contract grant and write step-up denial at $name',
  async (context) => {
    const f = fixture(context);
    for (const status of [401, 403]) {
      const denial = new HttpException('Current authority', status);
      f.wrapper.mockRejectedValueOnce(denial);
      await expect(f.invoke()).rejects.toBe(denial);
      expect(f.client.query).not.toHaveBeenCalled();
      f.wrapper.mockImplementationOnce(async (_profile, _actor, work) => {
        await work(f.client, false);
        throw denial;
      });
      await expect(f.invoke()).rejects.toBe(denial);
      noEffects(f.client);
      f.client.query.mockClear();
    }
  }
);
