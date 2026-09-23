import { expect, it, vi } from 'vitest';
import { ElectricityStaffReviewService } from './electricity-staff-review.service.js';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => ({ query }),
}));

it('exposes a cursor after 50 pending reviews and returns the following page', async () => {
  const submittedAt = new Date('2026-09-23T00:00:00.000Z');
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: `order-${String(index).padStart(2, '0')}`,
    profile_id: 'profile',
    customer_id: 'buyer',
    customer_name: 'Buyer',
    commercial_status: 'awaiting_staff_review',
    submitted_at: submittedAt,
    period_start: submittedAt,
    period_end: submittedAt,
    total_kwh: '10',
    pricing_snapshot: {},
    settings_snapshot: {},
    full_address: 'Electricity Street',
    postal_code: '1234567890',
    gift_code_id: null,
    contract_id: 'contract',
    contract_state: 'AwaitingStaffReview',
    version_id: 'version',
    contract_snapshot: {},
    invoice_id: 'invoice',
    activation_invoice_id: null,
    invoice_state: 'Unpaid',
    total_amount: '1000',
    paid_amount: '0',
    refunded_amount: '0',
    pending_refund_amount: '0',
  }));
  query.mockReset();
  query
    .mockResolvedValueOnce({ rows })
    .mockResolvedValueOnce({ rows: [{ id: rows[49]!.id, submitted_at: submittedAt }] })
    .mockResolvedValueOnce({ rows: [rows[50]] });
  const service = new ElectricityStaffReviewService({} as never, {} as never);
  const first = await service.queue();
  expect(first.orders).toHaveLength(50);
  expect(first.nextAfter).toBe(rows[49]!.id);
  const second = await service.queue(first.nextAfter!);
  expect(second.orders.map((order) => order.orderId)).toEqual([rows[50]!.id]);
  expect(second.nextAfter).toBeNull();
});
