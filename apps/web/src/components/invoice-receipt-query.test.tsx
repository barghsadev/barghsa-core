import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
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
  attachmentUrl: null,
  canConfirm: false,
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
  kind: string,
  held: boolean,
  signal: AbortSignal | undefined,
  finish: ((value: unknown) => void) | undefined;
const target = (path: string) =>
  kind === 'queue'
    ? path === base
    : kind === 'detail'
      ? path === base + '/' + receiptId
      : path === base + '/' + receiptId + '/allocation';
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
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      if (target(path) && !held) {
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
            <InvoiceBankReceiptQueue
              {...(kind === 'queue' ? {} : { initialSelection: { receiptId, state: 'Submitted' } })}
            />
          )}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
for (const name of ['queue', 'detail', 'allocation'])
  it.each(['unmount', 'actor', 'profile-context'])(
    'owns full receipt ' + name + ' bytes on %s without private work or commands',
    async (change) => {
      kind = name;
      await render();
      await vi.waitFor(() => expect(finish).toBeDefined());
      expect(signal?.aborted).toBe(false);
      const oldSignal = signal!,
        oldFinish = finish!,
        reads = vi.mocked(fetch).mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(reads);
      if (change === 'unmount') await render(false);
      else if (change === 'actor') await render(true, 'staff-two');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      await act(async () =>
        oldFinish(
          name === 'queue'
            ? { items: [{ ...receipt, payerReference: 'Private obsolete' }], nextCursor: null }
            : name === 'detail'
              ? { ...receipt, payerReference: 'Private obsolete' }
              : { ...allocation, walletCreditAmount: '777777777777777777' }
        )
      );
      expect(host.textContent).not.toContain('Private obsolete');
      expect(host.textContent).not.toContain('777777777777777777');
      if (change !== 'unmount') {
        expect(vi.mocked(fetch).mock.calls.filter(([url]) => target(String(url)))).toHaveLength(2);
        if (name !== 'queue') expect(host.textContent).toContain('Current receipt');
      }
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
        true
      );
    }
  );
