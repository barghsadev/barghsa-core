import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@barghsa/i18n/admin-ui';
import { en } from '@barghsa/i18n/contracts';
import { RefundPanel } from './RefundPanel.js';
import {
  refundDecisionReviewFixture,
  refundReviewFixture,
} from '../test/refund-review-fixtures.js';
import type { TeamAction } from './TeamActionDialog.js';
const invoiceId = '11111111-1111-4111-8111-111111111111',
  refundId = '22222222-2222-4222-8222-222222222222';
const h = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as ((value: unknown) => Promise<void>) | null,
  invalid: null as ((fields: unknown[]) => boolean) | null,
  denied: null as (() => void) | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, number: String }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    summary,
    onClose,
    onSuccess,
    onValidationError,
    onDenied,
  }: {
    action: TeamAction;
    summary: ReactNode;
    onClose: () => void;
    onSuccess: (value: unknown) => Promise<void>;
    onValidationError: (fields: unknown[]) => boolean;
    onDenied: () => void;
  }) => {
    useEffect(() => {
      h.action = action;
      h.success = onSuccess;
      h.invalid = onValidationError;
      h.denied = onDenied;
    });
    return (
      <div role="dialog">
        {summary}
        <button onClick={onClose}>Dismiss</button>
      </div>
    );
  },
}));
let host: HTMLDivElement,
  root: Root,
  available: string,
  readStatus: number,
  destination: 'wallet' | 'external_bank',
  reviewFailure: 'owned' | 'mixed' | 'denied' | 'invalid' | null,
  rowState: string,
  showRow: boolean;
const word = (key: string) => t('admin.invoices.walletRefunds.' + key, 'en');
const row = () => ({
  id: refundId,
  invoiceId,
  amount: '40',
  destination,
  state: rowState,
  bankReference: rowState === 'Processing' ? 'BANK-123' : null,
  reconciliationStatus: rowState === 'Processing' ? 'Pending' : null,
  approvalRequestId: null,
  retry: null,
});
const fetcher = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  h.action = null;
  h.success = null;
  h.invalid = null;
  h.denied = null;
  available = '100';
  readStatus = 200;
  destination = 'wallet';
  reviewFailure = null;
  rowState = 'Requested';
  showRow = false;
  fetcher.mockReset();
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.includes('?invoiceId='))
      return Response.json(
        {
          invoice: {
            invoiceId,
            profileId: '33333333-3333-4333-8333-333333333333',
            state: 'Paid',
            paidAmount: '100',
            refundedAmount: '0',
            reservedAmount: '0',
            availableAmount: available,
            requestable: true,
          },
          refunds: showRow ? [row()] : [],
          nextBefore: null,
        },
        { status: readStatus }
      );
    const body = JSON.parse(options?.body as string);
    if (reviewFailure === 'denied') return Response.json({}, { status: 403 });
    if (reviewFailure === 'owned' || reviewFailure === 'mixed')
      return Response.json(
        {
          error: {
            code: 'VALIDATION:INPUT:INVALID',
            fields: reviewFailure === 'owned' ? ['reason'] : ['reason', 'expectedReviewHash'],
          },
        },
        { status: 400 }
      );
    for (const operation of ['record-transfer', 'reconcile'] as const) {
      if (url.endsWith('/' + refundId + '/' + operation + '/review'))
        return Response.json(
          refundDecisionReviewFixture(
            invoiceId,
            refundId,
            destination,
            rowState,
            operation,
            body.bankReference
          )
        );
    }
    if (url.endsWith('/' + refundId + '/approve/review'))
      return Response.json(
        refundDecisionReviewFixture(invoiceId, refundId, destination, rowState, 'approve')
      );
    if (url.endsWith('/' + refundId + '/reject/review'))
      return Response.json(
        refundDecisionReviewFixture(
          invoiceId,
          refundId,
          destination,
          rowState,
          'reject',
          null,
          body.reason
        )
      );
    const value = refundReviewFixture(invoiceId, destination, body.amount, body.reason);
    if (reviewFailure === 'invalid') value.scope.resourceId = refundId;
    return Response.json(value);
  });
  vi.stubGlobal('fetch', fetcher);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(<RefundPanel destination={destination} selectedInvoiceId={invoiceId} />)
  );
}
async function input(id: string, value: string) {
  const node = host.querySelector<HTMLInputElement>('#' + id)!;
  expect(node).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
  await vi.waitFor(() =>
    expect(!!host.querySelector('[aria-busy=true]') && !host.querySelector('[role=dialog]')).toBe(
      false
    )
  );
  if (host.querySelector('[role=dialog]'))
    await vi.waitFor(() => expect(host.textContent).not.toContain(word('loading')));
}
async function requestDraft() {
  await render();
  await input('wallet-refund-amount', '۴۰');
  await input('wallet-refund-reason', '  Raw request reason  ');
}
it('validates blank submission and focuses the first owned field', async () => {
  await render();
  const count = fetcher.mock.calls.length;
  await click(word('request'));
  expect(h.action).toBeNull();
  expect(fetcher.mock.calls.length).toBe(count);
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(host.querySelector('#wallet-refund-amount'))
  );
  expect(
    host.querySelector('#wallet-refund-amount')?.getAttribute('aria-describedby')
  ).toBeTruthy();
});
it('preserves typed localized amounts and captures only canonical reviewed values', async () => {
  await requestDraft();
  await click(word('request'));
  await vi.waitFor(() =>
    expect(h.action?.body).toMatchObject({
      invoiceId,
      amount: '40',
      reason: 'Raw request reason',
      expectedReviewHash: 'a'.repeat(64),
      idempotencyKey: expect.any(String),
    })
  );
  await click('Dismiss');
  expect(host.querySelector<HTMLInputElement>('#wallet-refund-amount')?.value).toBe('۴۰');
  expect(host.querySelector<HTMLInputElement>('#wallet-refund-reason')?.value).toBe(
    '  Raw request reason  '
  );
});
it('retains raw drafts through failed and unchanged reads', async () => {
  await requestDraft();
  readStatus = 503;
  await click(word('refresh'));
  expect(host.querySelector<HTMLInputElement>('#wallet-refund-amount')?.value).toBe('۴۰');
  expect(host.querySelector<HTMLInputElement>('#wallet-refund-amount')?.disabled).toBe(true);
  readStatus = 200;
  await click(word('refresh'));
  expect(host.querySelector<HTMLInputElement>('#wallet-refund-reason')?.value).toBe(
    '  Raw request reason  '
  );
});
it('validates retained amounts against the fresh available balance', async () => {
  await requestDraft();
  available = '30';
  await click(word('refresh'));
  const count = fetcher.mock.calls.length;
  await click(word('request'));
  expect(fetcher.mock.calls.length).toBe(count);
  expect(h.action).toBeNull();
  expect(host.textContent).toContain(en.refundAmountInvalid);
});
it('maps owned review errors without clearing a companion amount', async () => {
  await requestDraft();
  reviewFailure = 'owned';
  await click(word('request'));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(host.querySelector('#wallet-refund-reason'))
  );
  expect(host.querySelector<HTMLInputElement>('#wallet-refund-amount')?.value).toBe('۴۰');
  expect(h.action).toBeNull();
});
it.each(['mixed', 'invalid'] as const)(
  'keeps %s review failures generic with drafts retained',
  async (failure) => {
    await requestDraft();
    reviewFailure = failure;
    await click(word('request'));
    expect(h.action).toBeNull();
    expect(host.querySelector('#wallet-refund-reason')?.getAttribute('aria-invalid')).toBeNull();
    expect(host.textContent).toContain(word('error'));
    expect(host.querySelector<HTMLInputElement>('#wallet-refund-amount')?.value).toBe('۴۰');
  }
);
it('clears private drafts and invoice data after denied review', async () => {
  await requestDraft();
  reviewFailure = 'denied';
  await click(word('request'));
  expect(host.querySelector('#wallet-refund-amount')).toBeNull();
  expect(host.textContent).not.toContain('Raw request reason');
  expect(host.querySelector<HTMLInputElement>('#wallet-refund-invoice')?.value).toBe('');
});
it('requires a matching request receipt before clearing drafts', async () => {
  await requestDraft();
  await click(word('request'));
  await expect(h.success!({ ...row(), invoiceId: refundId })).rejects.toThrow('acknowledgement');
  await click('Dismiss');
  expect(host.querySelector<HTMLInputElement>('#wallet-refund-reason')?.value).toBe(
    '  Raw request reason  '
  );
});
it('maps confirmation fields only for the captured request', async () => {
  await requestDraft();
  await click(word('request'));
  expect(h.invalid!(['reason', 'expectedReviewHash'])).toBe(false);
  await act(async () => expect(h.invalid!(['reason'])).toBe(true));
  await click('Dismiss');
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(host.querySelector('#wallet-refund-reason'))
  );
  expect(host.querySelector<HTMLInputElement>('#wallet-refund-amount')?.value).toBe('۴۰');
});
it('approval ignores the unsubmitted rejection draft and preserves the new request', async () => {
  showRow = true;
  await requestDraft();
  await input('wallet-refund-reason-' + refundId, '  Companion rejection  ');
  await click(word('approve'));
  expect(h.action?.body).toEqual({ expectedReviewHash: 'b'.repeat(64) });
  expect(h.invalid!(['reason'])).toBe(false);
  rowState = 'Approved';
  await act(async () => h.success!(row()));
  expect(host.querySelector<HTMLInputElement>('#wallet-refund-amount')?.value).toBe('۴۰');
  expect(host.querySelector<HTMLInputElement>('#wallet-refund-reason')?.value).toBe(
    '  Raw request reason  '
  );
});
it('reject validates its own reason and preserves the request draft', async () => {
  showRow = true;
  await requestDraft();
  await click(word('reject'));
  expect(h.action).toBeNull();
  await input('wallet-refund-reason-' + refundId, '  Decline return  ');
  await click(word('reject'));
  expect(h.action?.body).toEqual({ reason: 'Decline return', expectedReviewHash: 'b'.repeat(64) });
  expect(host.querySelector<HTMLInputElement>('#wallet-refund-amount')?.value).toBe('۴۰');
});
it('locks every editor after capturing a command', async () => {
  showRow = true;
  await requestDraft();
  await click(word('request'));
  const captured = h.action;
  expect([...host.querySelectorAll('input')].every((node) => node.disabled)).toBe(true);
  await click(word('approve'));
  expect(h.action).toBe(captured);
});
it('invalidates an old callback when the invoice scope changes', async () => {
  await requestDraft();
  await click(word('request'));
  const success = h.success!;
  await act(async () =>
    root.render(<RefundPanel destination="wallet" selectedInvoiceId={refundId} />)
  );
  await act(async () => success(row()));
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(host.textContent).not.toContain('Raw request reason');
});
it('denial makes captured callbacks obsolete', async () => {
  await requestDraft();
  await click(word('request'));
  const success = h.success!;
  await act(async () => h.denied!());
  const count = fetcher.mock.calls.length;
  await act(async () => success(row()));
  expect(fetcher.mock.calls.length).toBe(count);
  expect(host.querySelector('#wallet-refund-amount')).toBeNull();
});

it('validates bank reference length and captures only the selected transfer', async () => {
  destination = 'external_bank';
  showRow = true;
  rowState = 'Approved';
  await render();
  const label = t('admin.invoices.externalRefunds.record-transfer', 'en');
  await click(label);
  expect(h.action).toBeNull();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(host.querySelector('#refund-bank-reference-' + refundId))
  );
  await input('refund-bank-reference-' + refundId, 'x'.repeat(201));
  await click(label);
  expect(h.action).toBeNull();
  await input('refund-bank-reference-' + refundId, '  BANK-123  ');
  await click(label);
  expect(h.action?.body).toEqual({ bankReference: 'BANK-123', expectedReviewHash: 'b'.repeat(64) });
  expect(h.invalid!(['reason'])).toBe(false);
  await expect(
    h.success!({
      ...row(),
      state: 'Processing',
      bankReference: 'BANK-OTHER',
      reconciliationStatus: 'Pending',
    })
  ).rejects.toThrow('acknowledgement');
  await click('Dismiss');
  expect(host.querySelector<HTMLInputElement>('#refund-bank-reference-' + refundId)?.value).toBe(
    '  BANK-123  '
  );
});
it('requires a matching entered bank reference before requesting reconciliation review', async () => {
  destination = 'external_bank';
  showRow = true;
  rowState = 'Processing';
  await render();
  const label = t('admin.invoices.externalRefunds.reconcile', 'en');
  await input('refund-bank-reference-' + refundId, 'BANK-WRONG');
  const count = fetcher.mock.calls.length;
  await click(label);
  expect(fetcher.mock.calls.length).toBe(count);
  expect(host.textContent).toContain(en.refundBankReferenceMismatch);
  await input('refund-bank-reference-' + refundId, 'BANK-123');
  await click(label);
  expect(h.action?.body).toEqual({ bankReference: 'BANK-123', expectedReviewHash: 'b'.repeat(64) });
  await expect(
    h.success!({ ...row(), state: 'Completed', reconciliationStatus: 'Pending' })
  ).rejects.toThrow('acknowledgement');
});

it('disables loaded refund commands until the lookup again identifies that invoice', async () => {
  await requestDraft();
  await input('wallet-refund-invoice', refundId);
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false);
  const request = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === word('request')
  )!;
  expect(request.disabled).toBe(true);
  expect(host.textContent).toContain(en.refundLoadInvoice);
  await click(word('request'));
  expect(h.action).toBeNull();
  await input('wallet-refund-invoice', invoiceId);
  await click(word('request'));
  expect(h.action?.body).toMatchObject({ invoiceId, amount: '40' });
});
