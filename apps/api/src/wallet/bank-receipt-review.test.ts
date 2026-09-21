import { expect, it, vi } from 'vitest';
import { readBankReceiptConfirmationReview } from './bank-receipt-review.js';
import type { WalletQueryClient } from './wallet.service.js';

const profileId = '01900000-0000-7000-8000-000000000001';
const receiptId = '01900000-0000-7000-8000-000000000002';
const invoiceId = '01900000-0000-7000-8000-000000000003';
const input = {
  id: receiptId,
  profileId,
  amount: 1500n,
  submittedAt: new Date('2026-09-21T08:00:00.000Z'),
  receipt: null,
  attachmentKey: null,
  invoiceId: null as string | null,
};
function client(
  options: { profileId?: string; state?: string; threshold?: unknown; missingWallet?: boolean } = {}
) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('JOIN wallets w'))
      return {
        rows: options.missingWallet
          ? []
          : [
              {
                id: profileId,
                profile_type: 'LEGAL',
                title: 'Customer',
                posted_balance: '1000',
                reserved_balance: '100',
              },
            ],
      };
    if (sql.includes('FROM app_config'))
      return { rows: [{ value: options.threshold ?? { threshold_irr: 1000 } }] };
    if (sql.startsWith('SELECT id,profile_id,state'))
      return {
        rows: [
          {
            id: invoiceId,
            profile_id: options.profileId ?? profileId,
            state: options.state ?? 'Unpaid',
            total_amount: '1000',
            paid_amount: '0',
          },
        ],
      };
    if (sql.includes('FROM invoices i JOIN profiles'))
      return {
        rows: [
          {
            id: invoiceId,
            state: 'Unpaid',
            order_id: null,
            contract_id: null,
            issued_at: null,
            payable_from: null,
            due_at: null,
            total_amount: '1000',
            paid_amount: '0',
            order_type: null,
            profile_type: 'LEGAL',
            profile_title: 'Customer',
          },
        ],
      };
    if (sql.includes('FROM invoice_lines'))
      return {
        rows: [
          {
            id: invoiceId,
            description: 'Service',
            quantity: 1,
            unit_price: '1000',
            line_total: '1000',
            vat_rate: 0,
            vat_amount: '0',
            is_taxable: false,
          },
        ],
      };
    if (sql.includes('FROM contracts c')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query } as WalletQueryClient & { query: typeof query };
}

it('reviews the full wallet credit and the locked approval threshold', async () => {
  const review = await readBankReceiptConfirmationReview(client(), input);
  expect(review.data.allocation).toEqual({ invoiceAmount: '0', walletCredit: '1500' });
  expect(review.data.wallet).toEqual({ availableBefore: '900', availableAfter: '2400' });
  expect(review.data.approval).toEqual({ required: true, thresholdAmount: '1000' });
  expect(review.data.invoice).toBeNull();
});

it('reviews the actual invoice allocation and excess without changing balances', async () => {
  const db = client();
  const review = await readBankReceiptConfirmationReview(db, { ...input, invoiceId });
  expect(review.data.allocation).toEqual({ invoiceAmount: '1000', walletCredit: '500' });
  expect(review.data.wallet.availableAfter).toBe('1400');
  expect(review.data.invoice?.totals).toEqual({ subtotal: '1000', discount: '0', vat: '0' });
  expect(db.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  expect(db.query.mock.calls[0]?.[0]).toContain('FOR UPDATE OF w');
  expect(db.query.mock.calls[1]?.[0]).toContain('FOR UPDATE');
});

it.each([
  { profileId: receiptId },
  { state: 'Draft' },
  { threshold: { threshold_irr: 'corrupt' } },
  { missingWallet: true },
])('fails closed on invalid receipt context: %j', async (options) => {
  await expect(
    readBankReceiptConfirmationReview(client(options), { ...input, invoiceId })
  ).rejects.toThrow();
});

it('changes the review hash when the approval rule changes', async () => {
  const before = await readBankReceiptConfirmationReview(client(), input);
  const after = await readBankReceiptConfirmationReview(
    client({ threshold: { threshold_irr: 2000 } }),
    input
  );
  expect(after.data.approval.required).toBe(false);
  expect(after.hash).not.toBe(before.hash);
});
