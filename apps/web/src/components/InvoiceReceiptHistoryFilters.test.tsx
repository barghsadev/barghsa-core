import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InvoiceReceiptHistoryFilters } from './InvoiceReceiptHistoryFilters.js';
import { useListQuery } from '../hooks/useListQuery.js';
import { invoiceReceiptQueryOptions } from '../lib/finance-list-query.js';

const invoice = '11111111-1111-4111-8111-111111111111';
const amount = '9007199254740993';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', timezone: 'UTC', format: (value: string) => value }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String, money: (value: string) => `${value} IRR` }),
}));
let host: HTMLDivElement, root: Root, current: Record<string, unknown>;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  function Harness() {
    const [raw, setRaw] = useState<Record<string, unknown>>({
      receipt_q: 'original',
      receipt_order: 'asc',
      receipt_state: 'Confirmed',
      receipt_invoiceId: invoice,
      receipt_min: amount,
      receipt_max: amount,
      queue_q: 'pending',
      cursor: 'ledger',
      queue_cursor: 'queue',
    });
    current = raw;
    const binding = useListQuery(invoiceReceiptQueryOptions, raw, (update) => setRaw(update));
    return <InvoiceReceiptHistoryFilters binding={binding} />;
  }
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function click(label: string) {
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.getAttribute('aria-label') === label || button.textContent?.trim() === label
  )!;
  await act(async () => node.click());
}
async function type(label: string, value: string) {
  const element = [...document.querySelectorAll('label')].find(
    (node) => node.textContent === label
  )!;
  const input = document.getElementById(element.htmlFor) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('discards cancelled text and amount drafts without changing applied history or other lists', async () => {
  const applied = current;
  await click('Filters');
  await type('Search', 'cancel this');
  await type('Minimum amount (IRR)', '1');
  await click('Cancel');
  expect(current).toBe(applied);
  await click('Filters');
  expect(document.querySelector<HTMLInputElement>('[type="search"]')!.value).toBe('original');
  expect(
    [...document.querySelectorAll<HTMLInputElement>('input')].some((node) => node.value === amount)
  ).toBe(true);
});
it('applies the last text and exact amount edits once, preserving invoice/state and other list scopes', async () => {
  await click('Filters');
  await type('Search', '  Bank_%\\  ');
  await type('Minimum amount (IRR)', amount);
  await type('Maximum amount (IRR)', '9007199254740994');
  const select = document.querySelector<HTMLSelectElement>('[role="dialog"] select')!;
  await act(async () => {
    select.value = 'submitted_at:desc';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(current.receipt_q).toBe('original');
  await click('Apply filters');
  expect(current).toMatchObject({
    receipt_q: 'Bank_%\\',
    receipt_min: amount,
    receipt_max: '9007199254740994',
    receipt_order: undefined,
    receipt_invoiceId: invoice,
    receipt_state: 'Confirmed',
    queue_q: 'pending',
    queue_cursor: 'queue',
    cursor: 'ledger',
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('keeps invalid range drafts open and removes an invoice chip without changing remaining filters', async () => {
  await click('Filters');
  await type('Minimum amount (IRR)', '2');
  await type('Maximum amount (IRR)', '1');
  const before = current;
  await click('Apply filters');
  expect(current).toBe(before);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('[aria-invalid="true"]')).not.toBeNull();
  await click('Cancel');
  const chip = host.querySelector<HTMLButtonElement>(
    'button[aria-label^="Remove filter Invoice"]'
  )!;
  await act(async () => chip.click());
  expect(current).toMatchObject({
    receipt_invoiceId: undefined,
    receipt_state: 'Confirmed',
    receipt_q: 'original',
    receipt_min: amount,
    receipt_order: 'asc',
    queue_q: 'pending',
  });
});
