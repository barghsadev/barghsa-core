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
  customerNote: 'Branch transfer',
  submittedAt: '2026-09-24T00:00:00Z',
  attachmentUrl: 'https://storage.example.test/receipt.pdf',
  canConfirm: true,
  canReject: true,
  rejectionReason: null,
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
