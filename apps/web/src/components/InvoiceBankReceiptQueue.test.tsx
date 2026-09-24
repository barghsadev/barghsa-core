import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InvoiceBankReceiptQueue } from './InvoiceBankReceiptQueue.js';
import type { TeamAction } from './TeamActionDialog.js';

const RECEIPT = '11111111-1111-4111-8111-111111111111';
const INVOICE = '22222222-2222-4222-8222-222222222222';
const receipt = {
  receiptId: RECEIPT,
  invoiceId: INVOICE,
  profileId: '33333333-3333-4333-8333-333333333333',
  amount: '250000',
  state: 'Submitted',
  paymentDate: '2026-09-24',
  payerReference: 'TRK-123',
  bankName: 'Bank Mellat',
  customerNote: 'Branch transfer',
  submittedAt: '2026-09-24T00:00:00Z',
  attachmentUrl: 'https://storage.example.test/receipt.pdf',
  canConfirm: true,
  canReject: true,
  rejectionReason: null,
  invoiceAllocation: null,
  walletCreditAmount: null,
  dualApprovalPending: false,
};
const allocation = {
  receiptId: RECEIPT,
  invoiceId: INVOICE,
  invoiceState: 'Unpaid',
  receiptAmount: '250000',
  remaining: '100000',
  invoiceAllocation: '100000',
  walletCreditAmount: '150000',
};
const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  action: null as TeamAction | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: (value: string) => `${value} IRR` }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onSuccess,
  }: {
    action: TeamAction;
    onSuccess: () => Promise<void>;
  }) => {
    harness.action = action;
    return <button onClick={() => void onSuccess()}>{'Finish action'}</button>;
  },
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.locale = 'en';
  harness.action = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<InvoiceBankReceiptQueue />));
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (node) => node.textContent === text
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => button.click());
}
function api(options: { preview?: boolean; pending?: boolean } = {}) {
  return vi.fn(async (raw: string) => {
    const url = new URL(raw, 'https://app.example.test');
    if (url.pathname.endsWith('/allocation')) {
      return new Response(JSON.stringify(allocation), {
        status: options.preview === false ? 409 : 200,
      });
    }
    if (url.pathname.endsWith(`/${RECEIPT}`))
      return new Response(
        JSON.stringify({
          ...receipt,
          ...(options.pending ? { state: 'UnderReview', dualApprovalPending: true } : {}),
        })
      );
    return new Response(JSON.stringify({ items: [receipt] }));
  });
}

it.each(['en', 'fa'] as const)('reviews the allocation and receipt file in %s', async (locale) => {
  harness.locale = locale;
  const fetcher = api();
  vi.stubGlobal('fetch', fetcher);
  await render();
  await click(locale === 'en' ? 'Review receipt' : 'بررسی رسید');
  expect(container.textContent).toContain('100000 IRR');
  expect(container.textContent).toContain('Bank Mellat');
  expect(container.textContent).toContain('150000 IRR');
  expect(
    container.querySelector('a[href="https://storage.example.test/receipt.pdf"]')
  ).not.toBeNull();
  await click(locale === 'en' ? 'Confirm receipt' : 'تأیید رسید');
  expect(harness.action).toMatchObject({
    path: `/api/admin/invoices/bank-receipts/${RECEIPT}/confirm`,
    method: 'POST',
  });
  await click('Finish action');
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/bank-receipts')).length).toBe(
    2
  );
});

it('blocks confirmation when allocation fails, but permits a reasoned rejection', async () => {
  vi.stubGlobal('fetch', api({ preview: false }));
  await render();
  await click('Review receipt');
  expect(container.textContent).toContain('Could not preview the allocation');
  expect(
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (node) => node.textContent === 'Confirm receipt'
    )?.disabled
  ).toBe(true);
  const reason = container.querySelector<HTMLTextAreaElement>('#invoice-receipt-reason')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      reason,
      'Unreadable transfer evidence'
    );
    reason.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Reject receipt');
  expect(harness.action).toMatchObject({
    path: `/api/admin/invoices/bank-receipts/${RECEIPT}/reject`,
    body: { reason: 'Unreadable transfer evidence' },
  });
});

it('sends pending second approvals to the approval queue', async () => {
  vi.stubGlobal('fetch', api({ pending: true }));
  await render();
  await click('Review receipt');
  expect(container.querySelector('a[href="/admin/approval-requests"]')).not.toBeNull();
  expect(
    [...container.querySelectorAll('button')].some((node) => node.textContent === 'Confirm receipt')
  ).toBe(false);
});

it('shows no receipt data when finance access is denied', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 403 }))
  );
  await render();
  expect(container.textContent).toContain('You do not have access to review invoice receipts.');
  expect(container.textContent).not.toContain(INVOICE);
});

it('filters and pages terminal receipts, then opens their historic detail', async () => {
  const rejected = {
    ...receipt,
    state: 'Rejected',
    canConfirm: false,
    canReject: false,
    rejectionReason: 'Reference mismatch',
  };
  const fetcher = vi.fn(async (raw: string) => {
    const url = new URL(raw, 'https://app.example.test');
    if (url.pathname.endsWith('/history')) {
      const second = url.searchParams.has('beforeAt');
      return new Response(
        JSON.stringify({
          items: second
            ? []
            : [
                {
                  receiptId: RECEIPT,
                  invoiceId: INVOICE,
                  amount: receipt.amount,
                  bankName: receipt.bankName,
                  state: 'Rejected',
                  paymentDate: receipt.paymentDate,
                  submittedAt: receipt.submittedAt,
                },
              ],
          nextCursor: second ? null : { beforeAt: receipt.submittedAt, beforeId: RECEIPT },
        })
      );
    }
    if (url.pathname.endsWith(`/${RECEIPT}`)) return new Response(JSON.stringify(rejected));
    if (url.pathname.endsWith('/allocation'))
      throw new Error('Historical detail must not preview a new allocation');
    return new Response(JSON.stringify({ items: [] }));
  });
  vi.stubGlobal('fetch', fetcher);
  await render();
  await click('Reviewed receipt history');
  expect(container.textContent).toContain(RECEIPT);
  expect(container.textContent).toContain('Bank Mellat');
  const state = container.querySelector('select')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
      state,
      'Rejected'
    );
    state.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('state=Rejected'))).toBe(true);
  const invoiceInput = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      invoiceInput,
      INVOICE
    );
    invoiceInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Apply filter');
  expect(fetcher.mock.calls.some(([url]) => String(url).includes(`invoiceId=${INVOICE}`))).toBe(
    true
  );
  await click('Review receipt');
  expect(container.textContent).toContain('Reference mismatch');
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/allocation'))).toBe(false);
  await click('Next page');
  expect(container.textContent).toContain('No receipts match these filters.');
  await click('Previous page');
  expect(container.textContent).toContain(RECEIPT);
});

it('shows the settled allocation from a confirmed receipt without recalculating it', async () => {
  const fetcher = vi.fn(async (raw: string) => {
    const url = new URL(raw, 'https://app.example.test');
    if (url.pathname.endsWith('/history'))
      return new Response(
        JSON.stringify({
          items: [
            {
              receiptId: RECEIPT,
              invoiceId: INVOICE,
              amount: receipt.amount,
              bankName: receipt.bankName,
              state: 'Confirmed',
              paymentDate: receipt.paymentDate,
              submittedAt: receipt.submittedAt,
            },
          ],
          nextCursor: null,
        })
      );
    if (url.pathname.endsWith(`/${RECEIPT}`))
      return new Response(
        JSON.stringify({
          ...receipt,
          state: 'Confirmed',
          canConfirm: false,
          canReject: false,
          invoiceAllocation: '100000',
          walletCreditAmount: '150000',
        })
      );
    if (url.pathname.endsWith('/allocation')) throw new Error('Must use settled allocation');
    return new Response(JSON.stringify({ items: [] }));
  });
  vi.stubGlobal('fetch', fetcher);
  await render();
  await click('Reviewed receipt history');
  await click('Review receipt');
  expect(container.textContent).toContain('100000 IRR');
  expect(container.textContent).toContain('150000 IRR');
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/allocation'))).toBe(false);
});
