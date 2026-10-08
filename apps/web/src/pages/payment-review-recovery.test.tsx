import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Receipts from './AdminWalletReceiptsPage.js';
import Reconciliation from './AdminReconciliationPage.js';
import { TeamActionDialog } from '../components/TeamActionDialog.js';
import { bankReceiptReview } from '../test/bank-receipt-review-fixture.js';
import {
  receiptId,
  secondReceiptId,
  paymentInvoiceId,
  paymentReceipt,
  reconciliationItem,
} from '../test/payment-review-fixtures.js';

vi.mock('../components/WalletTopUpLimitConfigPanel.js', () => ({ default: () => null }));
const base = '/api/admin/wallet/bank-receipt-top-ups';
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  document.documentElement.lang = 'en';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function click(label: string, scope: ParentNode = document) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function fill(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function read(input: RequestInfo | URL) {
  const url = new URL(String(input), 'http://localhost');
  if (url.pathname.endsWith('/timezone')) return Response.json({ timezone: 'Asia/Tehran' });
  if (url.pathname.includes('/review'))
    return Response.json(
      bankReceiptReview(url.pathname.split('/').at(-2)!, url.searchParams.get('invoiceId'))
    );
  if (url.pathname === base) return Response.json({ items: [paymentReceipt] });
  if (url.pathname === `${base}/${receiptId}`) return Response.json(paymentReceipt);
  if (url.pathname.endsWith('/access')) return Response.json({ canView: true, canResolve: true });
  if (url.pathname === '/api/admin/reconciliation/items')
    return Response.json([reconciliationItem]);
  return Response.json({}, { status: 404 });
}
const confirm = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="wallet-receipt-confirm"]')!;
it('queue retry keeps the same receipt draft and invoice allocation without rereading unchanged work', async () => {
  let queueStatus = 200;
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    String(url) === base && queueStatus !== 200
      ? Response.json({}, { status: queueStatus })
      : read(url)
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<QueryProvider>{<Receipts />}</QueryProvider>));
  await fill('#reject-reason', 'Keep this bank discrepancy');
  await fill('input[name="invoiceId"]', paymentInvoiceId);
  const draft = document.querySelector('#reject-reason');
  const detailReads = fetcher.mock.calls.filter(([url]) => String(url) !== base).length;
  queueStatus = 503;
  await click('Refresh receipt queue');
  expect(document.querySelector('#reject-reason')).toBe(draft);
  expect(confirm().disabled).toBe(true);
  expect(container.textContent).not.toContain('No pending receipts');
  queueStatus = 200;
  await click('Retry receipt queue');
  expect((draft as HTMLTextAreaElement).value).toBe('Keep this bank discrepancy');
  expect(document.querySelector<HTMLInputElement>('input[name="invoiceId"]')!.value).toBe(
    paymentInvoiceId
  );
  expect(confirm().disabled).toBe(false);
  expect(fetcher.mock.calls.filter(([url]) => String(url) !== base)).toHaveLength(detailReads);
});
it('independent detail retry keeps the draft and blocks decisions until fresh eligibility arrives', async () => {
  let detailStatus = 503;
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    String(url) === `${base}/${receiptId}` && detailStatus !== 200
      ? Response.json({}, { status: detailStatus })
      : read(url)
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<QueryProvider>{<Receipts />}</QueryProvider>));
  await fill('#reject-reason', 'Keep detail draft');
  expect(confirm().disabled).toBe(true);
  detailStatus = 200;
  await click('Retry receipt details');
  expect(confirm().disabled).toBe(false);
  expect(document.querySelector<HTMLTextAreaElement>('#reject-reason')!.value).toBe(
    'Keep detail draft'
  );
  expect(fetcher.mock.calls.filter(([url]) => String(url) === base)).toHaveLength(1);
});
it('financial review retry keeps invoice and reason and binds confirmation to the recovered hash', async () => {
  let reviewStatus = 200;
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/review')) {
        if (reviewStatus !== 200) return Response.json({}, { status: reviewStatus });
        const review = bankReceiptReview(
          receiptId,
          new URL(String(url), 'http://localhost').searchParams.get('invoiceId')
        );
        review.hash = 'b'.repeat(64);
        return Response.json(review);
      }
      if (init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)));
        return Response.json({ ...paymentReceipt, state: 'Released', reviewHash: 'b'.repeat(64) });
      }
      return read(url);
    })
  );
  await act(async () => root.render(<QueryProvider>{<Receipts />}</QueryProvider>));
  await fill('input[name="invoiceId"]', paymentInvoiceId);
  await fill('#reject-reason', 'Reviewed transfer');
  reviewStatus = 503;
  await click('Review latest details');
  expect(confirm().disabled).toBe(true);
  expect(document.querySelector<HTMLInputElement>('input[name="invoiceId"]')!.value).toBe(
    paymentInvoiceId
  );
  reviewStatus = 200;
  await click('Review latest details');
  await act(async () => confirm().click());
  expect(bodies).toEqual([{ invoiceId: paymentInvoiceId, expectedReviewHash: 'b'.repeat(64) }]);
});
it('a queue denial clears private work and ignores a late financial review', async () => {
  let hold = false,
    denied = false;
  const pending = deferred();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) => {
      if (String(url) === base && denied)
        return Promise.resolve(Response.json({}, { status: 403 }));
      if (hold && String(url).includes('/review')) return pending.promise;
      return Promise.resolve(read(url));
    })
  );
  await act(async () => root.render(<QueryProvider>{<Receipts />}</QueryProvider>));
  await fill('#reject-reason', 'Private bank note');
  hold = true;
  await click('Review latest details');
  denied = true;
  await click('Refresh receipt queue');
  await act(async () => pending.resolve(Response.json(bankReceiptReview(receiptId))));
  expect(document.querySelector('#reject-reason')).toBeNull();
  expect(container.textContent).not.toContain('Private bank note');
  expect(container.textContent).not.toContain('TRK-primary');
  expect(container.textContent).toContain('You cannot view');
});
it('an obsolete financial denial cannot clear a newer selected receipt', async () => {
  const pending = deferred();
  let hold = false;
  const second = {
    ...paymentReceipt,
    transactionId: secondReceiptId,
    payerReference: 'TRK-second',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) => {
      if (String(url) === base)
        return Promise.resolve(Response.json({ items: [paymentReceipt, second] }));
      if (String(url) === `${base}/${secondReceiptId}`)
        return Promise.resolve(Response.json(second));
      if (hold && String(url).includes(`${receiptId}/review`)) return pending.promise;
      return Promise.resolve(read(url));
    })
  );
  await act(async () => root.render(<QueryProvider>{<Receipts />}</QueryProvider>));
  hold = true;
  await click('Review latest details');
  const select = [...container.querySelectorAll<HTMLButtonElement>('nav button')].find((b) =>
    b.textContent?.includes('TRK-second')
  )!;
  await act(async () => select.click());
  await fill('#reject-reason', 'Second receipt note');
  await act(async () => pending.resolve(Response.json({}, { status: 403 })));
  expect(confirm().disabled).toBe(false);
  expect(document.querySelector<HTMLTextAreaElement>('#reject-reason')!.value).toBe(
    'Second receipt note'
  );
  expect(container.textContent).not.toContain('You cannot view');
});
it('uncertain write errors remain visible through successful queue reads', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('Connection lost');
      return read(url);
    })
  );
  await act(async () => root.render(<QueryProvider>{<Receipts />}</QueryProvider>));
  await act(async () => confirm().click());
  expect(container.textContent).toContain('Failed to save');
  await click('Refresh receipt queue');
  expect(container.textContent).toContain('Failed to save');
  expect(confirm()).not.toBeNull();
});
it('fresh decision eligibility disables an old receipt without erasing its note', async () => {
  let changed = false;
  const fresh = { ...paymentReceipt, canDecide: false };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      if (changed && String(url) === base) return Response.json({ items: [fresh] });
      if (changed && String(url) === `${base}/${receiptId}`) return Response.json(fresh);
      return read(url);
    })
  );
  await act(async () => root.render(<QueryProvider>{<Receipts />}</QueryProvider>));
  await fill('#reject-reason', 'Retained review');
  changed = true;
  await click('Refresh receipt queue');
  expect(confirm()).toBeNull();
  expect(container.textContent).toContain('already been reviewed');
});
it('reconciliation read recovery keeps an open note and retries the same applied criteria without rereading access', async () => {
  const pending = deferred();
  let hold = false;
  const fetcher = vi.fn((url: RequestInfo | URL) =>
    hold && String(url).startsWith('/api/admin/reconciliation/items?')
      ? pending.promise
      : Promise.resolve(read(url))
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<QueryProvider>{<Reconciliation />}</QueryProvider>));
  hold = true;
  await click('Refresh exceptions');
  await click('Ledger mismatch');
  await fill('#rex-note', 'Keep this ledger investigation');
  const input = document.querySelector('#rex-note');
  const failedQuery = String(fetcher.mock.calls.at(-1)![0]);
  await act(async () => pending.resolve(Response.json({}, { status: 503 })));
  const accessReads = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/access')).length;
  hold = false;
  await click('Retry', document.querySelector('[role="dialog"]')!);
  expect(document.querySelector('#rex-note')).toBe(input);
  expect((input as HTMLTextAreaElement).value).toBe('Keep this ledger investigation');
  expect(String(fetcher.mock.calls.at(-1)![0])).toBe(failedQuery);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/access'))).toHaveLength(
    accessReads
  );
});
it('reconciliation permission recovery retains work on a transient error and clears it on denial', async () => {
  const pending = deferred();
  let accessStatus = 200,
    hold = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) => {
      if (hold && String(url).endsWith('/access')) return pending.promise;
      if (String(url).endsWith('/access') && accessStatus !== 200)
        return Promise.resolve(Response.json({}, { status: accessStatus }));
      return Promise.resolve(read(url));
    })
  );
  await act(async () => root.render(<QueryProvider>{<Reconciliation />}</QueryProvider>));
  hold = true;
  await click('Refresh exceptions');
  await click('Ledger mismatch');
  await fill('#rex-note', 'Protected investigation');
  await act(async () => pending.resolve(Response.json({}, { status: 503 })));
  expect(document.querySelector<HTMLTextAreaElement>('#rex-note')!.value).toBe(
    'Protected investigation'
  );
  hold = false;
  accessStatus = 403;
  await click('Retry access check', document.querySelector('[role="dialog"]')!);
  expect(document.querySelector('#rex-note')).toBeNull();
  expect(container.textContent).not.toContain('Ledger mismatch');
});
it('a fresh reconciliation state closes stale note work', async () => {
  const pending = deferred();
  let hold = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) =>
      hold && String(url).startsWith('/api/admin/reconciliation/items?')
        ? pending.promise
        : Promise.resolve(read(url))
    )
  );
  await act(async () => root.render(<QueryProvider>{<Reconciliation />}</QueryProvider>));
  hold = true;
  await click('Refresh exceptions');
  await click('Ledger mismatch');
  await fill('#rex-note', 'Old open state');
  await act(async () =>
    pending.resolve(
      Response.json([{ ...reconciliationItem, status: 'resolved', resolutionNote: 'Handled' }])
    )
  );
  expect(document.querySelector('#rex-note')).toBeNull();
  expect(container.textContent).toContain('Resolved');
});
it.each(['unmount', 'disable'] as const)(
  'password verification cannot post a confirmation after %s',
  async (change) => {
    const pending = deferred();
    const fetcher = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetcher);
    const action = {
      title: 'Review',
      description: 'Resolve exception',
      path: '/api/reconciliation/resolve',
      method: 'POST' as const,
      requiresPassword: true,
    };
    const props = { action, onSuccess: vi.fn(async () => {}), onClose: vi.fn() };
    await act(async () =>
      root.render(<QueryProvider>{<TeamActionDialog {...props} />}</QueryProvider>)
    );
    await fill('input[type="password"]', 'test-password');
    await click('Confirm');
    await act(async () =>
      root.render(
        <QueryProvider>
          {change === 'unmount' ? null : <TeamActionDialog {...props} confirmationDisabled />}
        </QueryProvider>
      )
    );
    await act(async () => pending.resolve(Response.json({ verified: true })));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(props.onSuccess).not.toHaveBeenCalled();
  }
);
it('a late queue success cannot restore private receipts after a newer detail denial', async () => {
  const pending = deferred();
  let holdQueue = false,
    denyReview = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) => {
      if (String(url) === base && holdQueue) return pending.promise;
      if (String(url).includes('/review') && denyReview)
        return Promise.resolve(Response.json({}, { status: 403 }));
      return Promise.resolve(read(url));
    })
  );
  await act(async () => root.render(<QueryProvider>{<Receipts />}</QueryProvider>));
  holdQueue = true;
  await click('Refresh receipt queue');
  denyReview = true;
  await click('Review latest details');
  expect(container.textContent).toContain('You cannot view');
  await act(async () => pending.resolve(Response.json({ items: [paymentReceipt] })));
  expect(container.textContent).toContain('You cannot view');
  expect(container.textContent).not.toContain('TRK-primary');
});
it('malformed rejection success cannot discard a review draft or claim a saved decision', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' ? Response.json({}) : read(url)
    )
  );
  await act(async () => root.render(<QueryProvider>{<Receipts />}</QueryProvider>));
  await fill('#reject-reason', 'Receipt reference does not match');
  await click('Reject receipt');
  expect(container.textContent).toContain('Failed to save');
  expect(document.querySelector<HTMLTextAreaElement>('#reject-reason')!.value).toBe(
    'Receipt reference does not match'
  );
  expect(container.textContent).not.toContain('Receipt rejected; balance unchanged');
});
it('a financial refresh cannot invalidate an in-flight rejection because decision controls wait for it', async () => {
  const pending = deferred();
  let hold = false;
  const fetcher = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST')
      return Promise.resolve(
        Response.json({ ...paymentReceipt, state: 'Rejected', canDecide: false })
      );
    if (hold && String(url).includes('/review')) return pending.promise;
    return Promise.resolve(read(url));
  });
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<QueryProvider>{<Receipts />}</QueryProvider>));
  await fill('#reject-reason', 'Duplicate bank receipt');
  hold = true;
  await click('Review latest details');
  const reject = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Reject receipt'
  )!;
  expect(reject.disabled).toBe(true);
  await act(async () => reject.click());
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  const review = bankReceiptReview(receiptId);
  review.hash = 'c'.repeat(64);
  await act(async () => pending.resolve(Response.json(review)));
  expect(reject.disabled).toBe(false);
  await act(async () => reject.click());
  expect(container.textContent).toContain('Receipt rejected; balance unchanged');
});
