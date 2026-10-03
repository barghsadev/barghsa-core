import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InvoiceBankReceiptQueue } from './InvoiceBankReceiptQueue.js';
import type { TeamAction } from './TeamActionDialog.js';
import { bankReceiptReview } from '../test/bank-receipt-review-fixture.js';

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
  statusHistory: [{ state: 'Submitted', occurredAt: '2026-09-24T00:00:00Z', backfilled: false }],
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
  finish: null as (() => Promise<void>) | null,
  validation: null as ((fields: unknown[]) => boolean) | null,
  close: null as (() => void) | null,
  deny: null as (() => void) | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    number: (value: number) => String(value),
    money: (value: string) => `${value} IRR`,
  }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    summary,
    onSuccess,
    onValidationError,
    onClose,
    onDenied,
  }: {
    action: TeamAction;
    summary: ReactNode;
    onSuccess: () => Promise<void>;
    onValidationError?: (fields: unknown[]) => boolean;
    onClose: () => void;
    onDenied?: () => void;
  }) => {
    harness.action = action;
    harness.finish = onSuccess;
    harness.validation = onValidationError ?? null;
    harness.close = onClose;
    harness.deny = onDenied ?? null;
    return (
      <div>
        {summary}
        <button onClick={() => void onSuccess()}>{'Finish action'}</button>
      </div>
    );
  },
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.locale = 'en';
  harness.action = null;
  harness.finish = null;
  harness.validation = null;
  harness.close = null;
  harness.deny = null;
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

it('previews the selected invoice receipt using its API attachment key and retains the original link', async () => {
  const baseFetch = api();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const response = await baseFetch(url);
      if (new URL(url, 'https://app.example.test').pathname.endsWith(`/${RECEIPT}`))
        return new Response(JSON.stringify({ ...receipt, attachmentKey: 'receipts/signed.PNG' }));
      return response;
    })
  );
  await render();
  await click('Review receipt');
  expect(container.querySelector('img')?.getAttribute('src')).toBe(receipt.attachmentUrl);
  expect(container.querySelector('a')?.getAttribute('href')).toBe(receipt.attachmentUrl);
});

it('opens a receipt selected from an invoice without an unnecessary allocation preview', async () => {
  const fetcher = api();
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(
      <InvoiceBankReceiptQueue initialSelection={{ receiptId: RECEIPT, state: 'Confirmed' }} />
    )
  );
  expect(
    container.querySelector('a[href="https://storage.example.test/receipt.pdf"]')
  ).not.toBeNull();
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith(`/${RECEIPT}/allocation`))).toBe(
    false
  );
});
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (node) => node.textContent === text
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => button.click());
}
it('switches receipt views without refetching or clearing an open rejection draft', async () => {
  const fetcher = api();
  vi.stubGlobal('fetch', fetcher);
  await render();
  await click('Review receipt');
  const input = container.querySelector<HTMLTextAreaElement>('#invoice-receipt-reason')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      'Retain bank investigation'
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const count = fetcher.mock.calls.length;
  await click('Table');
  expect(container.querySelectorAll('th')).toHaveLength(8);
  expect(container.querySelector<HTMLTextAreaElement>('#invoice-receipt-reason')!.value).toBe(
    'Retain bank investigation'
  );
  await click('Cards');
  expect(container.querySelector('table')).toBeNull();
  expect(container.querySelector<HTMLTextAreaElement>('#invoice-receipt-reason')!.value).toBe(
    'Retain bank investigation'
  );
  expect(fetcher).toHaveBeenCalledTimes(count);
});
function api(options: { preview?: boolean; pending?: boolean } = {}) {
  return vi.fn(async (raw: string) => {
    const url = new URL(raw, 'https://app.example.test');
    if (url.pathname.endsWith('/confirm/review')) {
      const review = bankReceiptReview(RECEIPT, INVOICE, receipt.profileId);
      review.scope.action = 'invoice.bank-receipt-confirmation';
      review.data.receipt.bankName = receipt.bankName;
      return new Response(JSON.stringify(review));
    }
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
  expect(container.textContent).toContain(
    locale === 'en' ? 'Receipt review timeline' : 'روند بررسی رسید'
  );
  expect(container.querySelector('time[dateTime="2026-09-24T00:00:00Z"]')).not.toBeNull();
  expect(
    container.querySelector('a[href="https://storage.example.test/receipt.pdf"]')
  ).not.toBeNull();
  await click(locale === 'en' ? 'Confirm receipt' : 'تأیید رسید');
  expect(harness.action).toMatchObject({
    path: `/api/admin/invoices/bank-receipts/${RECEIPT}/confirm`,
    method: 'POST',
    body: { expectedReviewHash: 'a'.repeat(64) },
  });
  expect(container.textContent).toContain('Customer profile');
  expect(container.textContent).toContain('TRK');
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
  const history = container.querySelector('[aria-label="Reviewed receipt history"]')!;
  const state = history.querySelector('select')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
      state,
      'Rejected'
    );
    state.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('state=Rejected'))).toBe(true);
  const invoiceInput = history.querySelector('input')!;
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

it('local list retry preserves a selected receipt draft and does not rerun its allocation', async () => {
  let failList = true;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/allocation')) return new Response(JSON.stringify(allocation));
    if (path.endsWith(`/${RECEIPT}`)) return new Response(JSON.stringify(receipt));
    return failList
      ? new Response(null, { status: 503 })
      : new Response(JSON.stringify({ items: [receipt] }));
  });
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(
      <InvoiceBankReceiptQueue initialSelection={{ receiptId: RECEIPT, state: 'Submitted' }} />
    )
  );
  const draft = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      draft,
      'Keep this explanation'
    );
    draft.dispatchEvent(new Event('input', { bubbles: true }));
  });
  failList = false;
  const retry = [...container.querySelectorAll('[data-slot="list-content"] button')].find(
    (button) => button.textContent === 'Retry'
  ) as HTMLButtonElement;
  await act(async () => retry.click());
  expect(container.querySelector('textarea')).toBe(draft);
  expect(draft.value).toBe('Keep this explanation');
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/allocation'))).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith(`/${RECEIPT}`))).toHaveLength(1);
});

it('a forbidden list refresh removes retained receipts and their selected review', async () => {
  let forbidden = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/allocation')) return new Response(JSON.stringify(allocation));
      if (path.endsWith(`/${RECEIPT}`)) return new Response(JSON.stringify(receipt));
      return forbidden
        ? new Response(null, { status: 403 })
        : new Response(JSON.stringify({ items: [receipt] }));
    })
  );
  await act(async () =>
    root.render(
      <InvoiceBankReceiptQueue initialSelection={{ receiptId: RECEIPT, state: 'Submitted' }} />
    )
  );
  expect(container.querySelector('textarea')).not.toBeNull();
  forbidden = true;
  await act(async () =>
    (
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Refresh'
      ) as HTMLButtonElement
    ).click()
  );
  expect(container.querySelector('textarea')).toBeNull();
  expect(container.querySelector('[data-slot="list-content"] ul')).toBeNull();
});

async function changeQueueOrder() {
  const select = container.querySelector('select')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
      select,
      'submitted_at:desc'
    );
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it.each(['resolve', 'reject'] as const)(
  'discards a late financial review that %ss after the same receipt is reopened in another queue',
  async (outcome) => {
    let finish!: (value: Response) => void;
    let fail!: (reason: Error) => void;
    const pending = new Promise<Response>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const baseFetch = api();
    let reviewCalls = 0;
    const fetcher = vi.fn(async (raw: string) => {
      if (raw.endsWith('/confirm/review') && ++reviewCalls === 1) return pending;
      return baseFetch(raw);
    });
    vi.stubGlobal('fetch', fetcher);
    await render();
    await click('Review receipt');
    await click('Confirm receipt');
    await changeQueueOrder();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.textContent).not.toContain('Finish action');
    expect(fetcher.mock.calls.some(([url]) => url.includes('sort=submitted_at%3Adesc'))).toBe(true);
    await click('Review receipt');
    await click('Confirm receipt');
    expect(container.textContent).toContain('Finish action');
    const currentAction = harness.action;
    await act(async () => {
      if (outcome === 'resolve') finish(await baseFetch('/confirm/review'));
      else fail(new Error('Old review failed'));
    });
    expect(harness.action).toBe(currentAction);
    expect(container.textContent).toContain('Finish action');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  }
);

it('invalidates an approval dialog and its late success callback when pending queue criteria change', async () => {
  const fetcher = api();
  vi.stubGlobal('fetch', fetcher);
  await render();
  await click('Review receipt');
  await click('Confirm receipt');
  const oldFinish = harness.finish!;
  await changeQueueOrder();
  expect(container.textContent).not.toContain('Finish action');
  expect(container.querySelector('textarea')).toBeNull();
  const reads = fetcher.mock.calls.length;
  await act(async () => oldFinish());
  expect(fetcher).toHaveBeenCalledTimes(reads);
});

async function editRejection(value: string) {
  const input = container.querySelector<HTMLTextAreaElement>('#invoice-receipt-reason')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
it.each(['', 'bad\u0000reason', 'x'.repeat(2001)])(
  'blocks invalid invoice receipt rejection and focuses the retained reason: %j',
  async (value) => {
    vi.stubGlobal('fetch', api());
    await render();
    await click('Review receipt');
    const input = await editRejection(value);
    await click('Reject receipt');
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.value).toBe(value);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(harness.action).toBeNull();
    await editRejection('Corrected rejection');
    await vi.waitFor(() => expect(input.getAttribute('aria-invalid')).not.toBe('true'));
  }
);
it.each(['en', 'fa'] as const)(
  'returns a server reason error to the retained invoice editor in %s',
  async (locale) => {
    harness.locale = locale;
    vi.stubGlobal('fetch', api());
    await render();
    await click(locale === 'en' ? 'Review receipt' : 'بررسی رسید');
    const input = await editRejection('  Preserve this investigation  ');
    await click(locale === 'en' ? 'Reject receipt' : 'رد رسید');
    expect(input.disabled).toBe(true);
    expect(harness.action?.body).toEqual({ reason: 'Preserve this investigation' });
    await act(async () => {
      expect(harness.validation?.(['reason'])).toBe(true);
      harness.close?.();
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('  Preserve this investigation  ');
    const errorId = input.getAttribute('aria-describedby')!.split(' ')[0]!;
    expect(document.getElementById(errorId)?.textContent).toContain(
      locale === 'en' ? '1–2000' : '۲۰۰۰'
    );
  }
);
it('keeps mixed protected metadata generic and clears retained work on decision permission denial', async () => {
  vi.stubGlobal('fetch', api());
  await render();
  await click('Review receipt');
  const input = await editRejection('Retain until access changes');
  await click('Reject receipt');
  await act(async () => expect(harness.validation?.(['reason', 'receiptId'])).toBe(false));
  expect(input.getAttribute('aria-invalid')).not.toBe('true');
  expect(input.value).toBe('Retain until access changes');
  await act(async () => harness.deny?.());
  expect(container.querySelector('#invoice-receipt-reason')).toBeNull();
  expect(container.textContent).toContain('You do not have access to review invoice receipts.');
  expect(container.textContent).not.toContain(RECEIPT);
});
it('does not open a rejection when the selected receipt closes during validation', async () => {
  vi.stubGlobal('fetch', api());
  await render();
  await click('Review receipt');
  const input = await editRejection('Obsolete rejection');
  await act(async () => {
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Close')!
      .click();
  });
  expect(container.querySelector('#invoice-receipt-reason')).toBeNull();
  expect(container.querySelector('button')?.textContent).not.toBe('Finish action');
  expect(harness.action).toBeNull();
});
