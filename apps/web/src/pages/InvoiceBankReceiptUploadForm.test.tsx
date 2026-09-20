import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InvoiceBankReceiptUploadForm } from './InvoiceBankReceiptUploadForm.js';
import {
  fetchActiveProfileId,
  submitInvoiceBankReceipt,
  utcTodayIso,
} from '../lib/invoice-bank-receipt-upload.js';
const upload = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useReceiptAttachmentUpload.js', () => ({
  useReceiptAttachmentUpload: () => upload,
}));
type ReceiptUploadModule = typeof import('../lib/invoice-bank-receipt-upload.js');
vi.mock('../lib/invoice-bank-receipt-upload.js', async (importOriginal) => {
  const actual = (await importOriginal()) as ReceiptUploadModule;
  return { ...actual, fetchActiveProfileId: vi.fn(), submitInvoiceBankReceipt: vi.fn() };
});
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  document.documentElement.lang = 'en';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(fetchActiveProfileId).mockReset().mockResolvedValue('profile-1');
  vi.mocked(submitInvoiceBankReceipt)
    .mockReset()
    .mockResolvedValue({ ok: true, state: 'Submitted', amount: 100n });
  upload.mockReset().mockResolvedValue('attachment-key');
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const field = (name: string) =>
  container.querySelector(`[data-testid="invoice-receipt-${name}"]`) as HTMLInputElement;
async function change(name: string, value: string) {
  await act(async () => {
    const element = field(name);
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function file(
  value: File | null = new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' })
) {
  await act(async () => {
    Object.defineProperty(field('file'), 'files', {
      value: value ? [value] : [],
      configurable: true,
    });
    field('file').dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
async function render(onSubmitted?: () => Promise<void>) {
  await act(async () =>
    root.render(
      <InvoiceBankReceiptUploadForm
        invoiceId="invoice-1"
        {...(onSubmitted ? { onSubmitted } : {})}
      />
    )
  );
}
async function valid() {
  await change('amount', '۱۰۰');
  await change('date', utcTodayIso());
  await change('payer-ref', ' reference ');
  await file();
}
const alert = () => container.querySelector('[role="alert"]');

it('validates fields in sequence and clears each error when corrected', async () => {
  await render();
  await submit();
  expect(field('amount').getAttribute('aria-invalid')).toBe('true');
  await change('amount', '۱۰۰');
  expect(alert()).toBeNull();
  await submit();
  expect(field('date').getAttribute('aria-invalid')).toBe('true');
  await change('date', '2999-01-01');
  await submit();
  expect(field('date').getAttribute('aria-invalid')).toBe('true');
  await change('date', utcTodayIso());
  expect(alert()).toBeNull();
  await submit();
  expect(field('payer-ref').getAttribute('aria-invalid')).toBe('true');
  await change('payer-ref', 'reference');
  expect(alert()).toBeNull();
  await submit();
  expect(field('file').getAttribute('aria-invalid')).toBe('true');
  await file(new File(['no'], 'receipt.exe', { type: 'application/octet-stream' }));
  await submit();
  expect(field('file').getAttribute('aria-invalid')).toBe('true');
  await file();
  expect(alert()).toBeNull();
  await file(null);
  await submit();
  expect(field('file').getAttribute('aria-invalid')).toBe('true');
  expect(upload).not.toHaveBeenCalled();
  expect(submitInvoiceBankReceipt).not.toHaveBeenCalled();
});

it('does not upload without an active profile', async () => {
  vi.mocked(fetchActiveProfileId).mockResolvedValue(null);
  await render();
  await valid();
  await submit();
  expect(alert()).not.toBeNull();
  expect(upload).not.toHaveBeenCalled();
});

it.each(['missing', 'rejected'])('allows retry after an attachment upload is %s', async (mode) => {
  await render();
  await valid();
  if (mode === 'missing') upload.mockResolvedValueOnce(null);
  else upload.mockRejectedValueOnce(new Error('offline'));
  await submit();
  expect(alert()).not.toBeNull();
  expect(submitInvoiceBankReceipt).not.toHaveBeenCalled();
  await file();
  expect(alert()).toBeNull();
  await submit();
  expect(container.querySelector('[role="status"]')).not.toBeNull();
});

it('preserves a failed submission and sends trimmed notes on retry', async () => {
  const onSubmitted = vi.fn().mockResolvedValue(undefined);
  await render(onSubmitted);
  await valid();
  await change('note', ' customer note ');
  vi.mocked(submitInvoiceBankReceipt).mockResolvedValueOnce({ ok: false, status: 409 });
  await submit();
  expect(alert()).not.toBeNull();
  expect(onSubmitted).not.toHaveBeenCalled();
  expect(field('amount').value).toBe('100');
  await submit();
  expect(submitInvoiceBankReceipt).toHaveBeenLastCalledWith({
    invoiceId: 'invoice-1',
    amountIrR: 100n,
    paymentDate: utcTodayIso(),
    payerReference: 'reference',
    attachmentKey: 'attachment-key',
    customerNote: 'customer note',
  });
  expect(onSubmitted).toHaveBeenCalledTimes(1);
  expect(field('amount').value).toBe('');
  expect(field('note').value).toBe('');
});

it('ignores another submit while an upload is pending', async () => {
  let finish!: (key: string) => void;
  upload.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finish = resolve;
    })
  );
  await render();
  await valid();
  await submit();
  expect(field('submit').disabled).toBe(true);
  await submit();
  expect(upload).toHaveBeenCalledTimes(1);
  await act(async () => finish('attachment-key'));
  expect(submitInvoiceBankReceipt).toHaveBeenCalledTimes(1);
  expect(field('submit').disabled).toBe(false);
});

it('ignores a profile lookup that finishes after the form unmounts', async () => {
  let finish!: (id: string) => void;
  vi.mocked(fetchActiveProfileId).mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finish = resolve;
    })
  );
  await render();
  await act(async () => root.render(null));
  await act(async () => finish('profile-late'));
  expect(container.textContent).toBe('');
});
