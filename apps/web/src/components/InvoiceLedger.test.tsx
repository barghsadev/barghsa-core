import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InvoiceLedger } from './InvoiceLedger.js';

const ID = '11111111-1111-7111-8111-111111111111';
const PROFILE = '22222222-2222-7222-8222-222222222222';
const row = {
  invoiceId: ID,
  profileId: PROFILE,
  orderId: null,
  type: 'manual',
  state: 'Unpaid',
  totalAmount: '109000',
  paidAmount: '0',
  refundedAmount: '0',
  issuedAt: '2026-09-01T00:00:00Z',
  dueAt: '2026-10-01T00:00:00Z',
  periodStart: '2026-10-01T00:00:00Z',
  periodEnd: '2026-11-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
};

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (value: string | null) => value ?? '—' }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    money: (value: string | bigint) => `${value} IRR`,
    number: (value: number) => String(value),
  }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('opens staff invoice detail with line VAT and payment history, then selects its due-date tool', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith(`/${ID}`))
      return new Response(
        JSON.stringify({
          ...row,
          lines: [
            {
              description: 'Electricity',
              quantity: 1,
              unitPrice: '100000',
              lineTotal: '100000',
              vatRate: 900,
              vatAmount: '9000',
            },
          ],
          activity: {
            payments: [
              {
                id: 'p1',
                source: 'wallet',
                amount: '10000',
                state: 'Confirmed',
                createdAt: row.createdAt,
              },
            ],
            bankReceipts: [
              {
                id: 'receipt-1',
                amount: '9000',
                state: 'Confirmed',
                paymentDate: '2026-09-01',
                bankName: 'Bank Mellat',
                payerReference: 'TRK-1',
                createdAt: row.createdAt,
              },
            ],
            refunds: [],
          },
        })
      );
    return new Response(JSON.stringify({ items: [row], nextCursor: null }));
  });
  vi.stubGlobal('fetch', fetcher);
  const onSelectForDueAt = vi.fn();
  const onOpenReceipt = vi.fn();
  await act(async () =>
    root.render(<InvoiceLedger onSelectForDueAt={onSelectForDueAt} onOpenReceipt={onOpenReceipt} />)
  );
  expect(container.textContent).toContain('109000 IRR');
  expect(container.textContent).toContain('Electricity service period');
  await act(async () => (container.querySelector('tbody button') as HTMLButtonElement).click());
  expect(container.textContent).toContain('Electricity');
  expect(container.textContent).toContain('9000 IRR');
  expect(container.textContent).toContain('Wallet');
  const receiptButton = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Open receipt scan'
  );
  await act(async () => receiptButton!.click());
  expect(onOpenReceipt).toHaveBeenCalledWith('receipt-1', 'Confirmed');
  const dueButton = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Use in due-date tool'
  );
  await act(async () => dueButton!.click());
  expect(onSelectForDueAt).toHaveBeenCalledWith(ID);
});

it('shows a permission error without exposing ledger rows', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 403 }))
  );
  await act(async () =>
    root.render(<InvoiceLedger onSelectForDueAt={vi.fn()} onOpenReceipt={vi.fn()} />)
  );
  expect(container.textContent).toContain('You do not have permission to view invoices.');
  expect(container.querySelector('tbody')).toBeNull();
});

it('loads an exact invoice from a staff deep link', async () => {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(input).endsWith(`/${ID}`)
            ? { ...row, lines: [], activity: { payments: [], bankReceipts: [], refunds: [] } }
            : { items: [row], nextCursor: null }
        )
      )
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(
      <InvoiceLedger initialInvoiceId={ID} onSelectForDueAt={vi.fn()} onOpenReceipt={vi.fn()} />
    )
  );
  expect(fetcher.mock.calls.some(([url]) => String(url).includes(`invoiceId=${ID}`))).toBe(true);
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith(`/${ID}`))).toBe(true);
  expect(container.querySelector('#invoice-ledger-detail-title')).not.toBeNull();
});
