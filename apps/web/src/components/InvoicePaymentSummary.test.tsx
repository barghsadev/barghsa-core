import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CustomerInvoiceNode } from '../lib/customer-invoices.js';
import { InvoicePaymentSummary, invoicePaymentProgress } from './InvoicePaymentSummary.js';

vi.mock('../hooks/useLocale.js', () => ({
  useLocale: () => (document.documentElement.lang === 'fa' ? 'fa' : 'en'),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: (value: string) => `${value} IRR` }),
}));
vi.mock('./WalletInvoicePaymentPanel.js', () => ({
  WalletInvoicePaymentPanel: ({ eligible }: { eligible: boolean }) => (
    <button type="button" disabled={!eligible} data-testid="wallet-pay">
      Pay with wallet
    </button>
  ),
}));

const invoice: CustomerInvoiceNode = {
  invoiceId: '11111111-1111-7111-8111-111111111111',
  role: 'original',
  state: 'PartiallyFunded',
  totalAmount: '9007199254740993',
  paidAmount: '4503599627370496',
  refundedAmount: '0',
  accountingAmount: '9007199254740993',
  adjustmentKind: null,
  issuedAt: '2026-09-01T00:00:00Z',
  payableFrom: '2026-09-01T00:00:00Z',
  dueAt: '2026-10-01T00:00:00Z',
  cancelledAt: null,
  createdAt: '2026-09-01T00:00:00Z',
  replacesInvoiceId: null,
  adjustmentForInvoiceId: null,
  explanation: null,
  lines: [],
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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

it('calculates remaining IRR and percentage exactly above Number.MAX_SAFE_INTEGER', () => {
  expect(invoicePaymentProgress(invoice.totalAmount, invoice.paidAmount)).toEqual({
    remainingAmount: '4503599627370497',
    percent: 49,
  });
  expect(invoicePaymentProgress('100', '101')).toBeNull();
  expect(invoicePaymentProgress('invalid', '0')).toBeNull();
});

it.each([
  ['en', 'Payment status', 'Remaining to pay'],
  ['fa', 'وضعیت پرداخت', 'مانده قابل پرداخت'],
])('shows the exact payment progress in %s', async (locale, title, remaining) => {
  document.documentElement.lang = locale;
  await act(async () =>
    root.render(<InvoicePaymentSummary invoice={invoice} onRefreshDetails={vi.fn()} />)
  );
  expect(container.textContent).toContain(title);
  expect(container.textContent).toContain(remaining);
  expect(container.textContent).toContain('4503599627370497 IRR');
  const bar = container.querySelector('[role="progressbar"]')!;
  expect(bar.getAttribute('aria-valuenow')).toBe('49');
  expect(bar.querySelector('div')?.getAttribute('style')).toContain('49%');
  expect(
    (container.querySelector('[data-testid="wallet-pay"]') as HTMLButtonElement).disabled
  ).toBe(false);
});

it('does not offer wallet payment for a pending review or cancelled invoice', async () => {
  await act(async () =>
    root.render(
      <InvoicePaymentSummary
        invoice={{ ...invoice, state: 'PaymentUnderReview' }}
        onRefreshDetails={vi.fn()}
      />
    )
  );
  expect(
    (container.querySelector('[data-testid="wallet-pay"]') as HTMLButtonElement).disabled
  ).toBe(true);
  expect(container.textContent).toContain('4503599627370497 IRR');
  await act(async () =>
    root.render(
      <InvoicePaymentSummary
        invoice={{ ...invoice, state: 'Cancelled' }}
        onRefreshDetails={vi.fn()}
      />
    )
  );
  expect(container.textContent).toContain('This invoice was cancelled');
  expect(container.textContent).not.toContain('Remaining to pay');
  expect(
    (container.querySelector('[data-testid="wallet-pay"]') as HTMLButtonElement).disabled
  ).toBe(true);
});

it('does not present a credit adjustment as an amount to pay', async () => {
  await act(async () =>
    root.render(
      <InvoicePaymentSummary
        invoice={{ ...invoice, adjustmentKind: 'credit' }}
        onRefreshDetails={vi.fn()}
      />
    )
  );
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
  expect(container.querySelector('[data-testid="wallet-pay"]')).toBeNull();
});
