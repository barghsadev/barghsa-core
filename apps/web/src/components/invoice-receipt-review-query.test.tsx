import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { bankReceiptReview } from '../test/bank-receipt-review-fixture.js';
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { InvoiceBankReceiptQueue } from './InvoiceBankReceiptQueue.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: String }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String, money: (value: string) => value + ' IRR' }),
}));
const base = '/api/admin/invoices/bank-receipts',
  receiptId = '11111111-1111-4111-8111-111111111111',
  invoiceId = '22222222-2222-4222-8222-222222222222';
const receipt = {
  receiptId,
  invoiceId,
  profileId: '33333333-3333-4333-8333-333333333333',
  amount: '250000',
  state: 'Submitted',
  paymentDate: '2026-09-24',
  payerReference: 'Current receipt',
  bankName: 'Current bank',
  customerNote: null,
  submittedAt: '2026-09-24T00:00:00Z',
  attachmentUrl: 'https://files.example.test/receipt.pdf',
  canConfirm: true,
  canReject: true,
  rejectionReason: null,
  invoiceAllocation: null,
  walletCreditAmount: null,
  confirmedAt: null,
  requiresDualApproval: false,
  dualApprovalPending: false,
};
const allocation = {
  receiptId,
  invoiceId,
  invoiceState: 'Unpaid',
  receiptAmount: '250000',
  remaining: '100000',
  invoiceAllocation: '100000',
  walletCreditAmount: '150000',
};
let root: Root,
  host: HTMLDivElement,
  held: boolean,
  signal: AbortSignal | undefined,
  finish: ((value: unknown) => void) | undefined;
const target = base + '/' + receiptId + '/confirm/review';
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({ summary }: { summary: ReactNode }) => (
    <div data-testid="owned-review-dialog">{summary}</div>
  ),
}));
function review() {
  const value = bankReceiptReview(receiptId, invoiceId, receipt.profileId);
  value.scope.action = 'invoice.bank-receipt-confirmation';
  return value;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  held = false;
  signal = undefined;
  finish = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      expect(init?.credentials).toBe('include');
      if (path === target) {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe('{}');
        if (held) return Response.json(review());
        held = true;
        signal = init!.signal as AbortSignal;
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        } as Response;
      }
      if (path === base) return Response.json({ items: [], nextCursor: null });
      if (path === base + '/' + receiptId) return Response.json(receipt);
      if (path === base + '/' + receiptId + '/allocation') return Response.json(allocation);
      throw Error('Unexpected ' + path);
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(present = true, actor = 'staff-one') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {present && (
            <InvoiceBankReceiptQueue initialSelection={{ receiptId, state: 'Submitted' }} />
          )}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (node) => node.textContent === text
  )!;
  expect(button).toBeDefined();
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}
it.each(['unmount', 'actor', 'profile-context', 'close'])(
  'cancels an actual confirmation-review body on %s without old financial approval or command',
  async (change) => {
    await render();
    await click('Confirm receipt');
    await vi.waitFor(() => expect(finish).toBeDefined());
    const oldSignal = signal!,
      oldFinish = finish!;
    expect(oldSignal.aborted).toBe(false);
    const count = vi.mocked(fetch).mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    expect(fetch).toHaveBeenCalledTimes(count);
    if (change === 'unmount') await render(false);
    else if (change === 'actor') await render(true, 'staff-two');
    else if (change === 'profile-context') await act(async () => refreshProfileContext());
    else await click('Close');
    expect(oldSignal.aborted).toBe(true);
    const obsolete = review();
    obsolete.data.receipt.bankName = 'obsolete-private-review';
    await act(async () => oldFinish(obsolete));
    await act(async () => vi.dynamicImportSettled());
    expect(host.textContent).not.toContain('obsolete-private-review');
    expect(host.querySelector('[data-testid=owned-review-dialog]')).toBeNull();
    if (change === 'actor' || change === 'profile-context') {
      await click('Confirm receipt');
      await act(async () => vi.dynamicImportSettled());
      expect(host.querySelector('[data-testid=owned-review-dialog]')).not.toBeNull();
    }
    const posts = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts.every(([path]) => String(path) === target)).toBe(true);
    expect(posts.every(([, init]) => init?.body === '{}')).toBe(true);
  }
);
