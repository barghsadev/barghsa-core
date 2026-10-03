import { act } from 'react';
import { refreshProfileContext } from '../lib/profile-context.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InvoiceBankReceiptUploadForm } from './InvoiceBankReceiptUploadForm.js';
import {
  fetchActiveProfileId,
  submitInvoiceBankReceipt,
  utcTodayIso,
} from '../lib/invoice-bank-receipt-upload.js';
import { loadInvoiceBankReceiptSubmissionReview } from '../lib/invoice-bank-receipt-review-action.js';
const upload = vi.hoisted(() => vi.fn());
type ReceiptUploadModule = typeof import('../lib/invoice-bank-receipt-upload.js');
vi.mock('../lib/invoice-bank-receipt-upload.js', async (importOriginal) => {
  const actual = (await importOriginal()) as ReceiptUploadModule;
  return {
    ...actual,
    uploadInvoiceReceiptAttachment: upload,
    fetchActiveProfileId: vi.fn(),
    submitInvoiceBankReceipt: vi.fn(),
  };
});
vi.mock('../lib/invoice-bank-receipt-review-action.js', () => ({
  loadInvoiceBankReceiptSubmissionReview: vi.fn(),
}));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(fetchActiveProfileId).mockReset().mockResolvedValue('profile-1');
  vi.mocked(submitInvoiceBankReceipt)
    .mockReset()
    .mockResolvedValue({ ok: true, state: 'Submitted', amount: 100n });
  upload.mockReset().mockResolvedValue('attachment-key');
  vi.mocked(loadInvoiceBankReceiptSubmissionReview)
    .mockReset()
    .mockImplementation(async (input) => ({
      kind: 'success',
      review: {
        schemaVersion: 1,
        scope: {
          action: 'invoice.bank-receipt-submission',
          profileId: 'profile-1',
          resourceId: input.invoiceId,
        },
        data: {
          invoiceId: input.invoiceId,
          profileId: 'profile-1',
          invoiceState: 'Issued',
          invoiceTotalIrR: '1000',
          invoicePaidIrR: '0',
          invoiceRemainingIrR: '1000',
          amountIrR: input.amountIrR,
          paymentDate: input.paymentDate,
          payerReference: input.payerReference,
          bankName: input.bankName,
          attachmentKey: input.attachmentKey,
          fileName: 'receipt.pdf',
          fileSizeBytes: '7',
          customerNote: input.customerNote,
          stateAfterSubmission: 'Submitted',
          settlementRule: 'after_finance_confirmation',
          excessRule: 'confirmed_excess_to_wallet',
        },
        hash: 'a'.repeat(64),
      },
    }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
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
async function confirm() {
  await act(async () => {
    await import('../components/InvoiceBankReceiptSubmissionReviewDialog.js');
  });
  for (let i = 0; i < 20 && !document.querySelector('[role="dialog"]'); i++) {
    await act(async () => Promise.resolve());
  }
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (candidate) => candidate.textContent?.includes('Confirm and submit receipt')
  );
  expect(button, document.body.textContent ?? '').toBeDefined();
  await act(async () => button!.click());
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

it('links all invalid fields and clears each corrected field without uploading', async () => {
  await render();
  await submit();
  await vi.waitFor(() => expect(field('amount').getAttribute('aria-invalid')).toBe('true'));
  for (const name of ['amount', 'date', 'payer-ref', 'file']) {
    const input = field(name);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(
      input
        .getAttribute('aria-describedby')!
        .split(' ')
        .map((id) => document.getElementById(id))
        .find((node) => node?.getAttribute('role') === 'alert')
        ?.getAttribute('role')
    ).toBe('alert');
  }
  await act(
    async () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  expect(document.activeElement).toBe(field('amount'));
  await change('amount', '۱۰۰');
  expect(field('amount').getAttribute('aria-invalid')).toBeNull();
  await change('date', '2999-01-01');
  expect(field('date').getAttribute('aria-invalid')).toBe('true');
  await change('date', utcTodayIso());
  expect(field('date').getAttribute('aria-invalid')).toBeNull();
  await change('payer-ref', 'reference');
  expect(field('payer-ref').getAttribute('aria-invalid')).toBeNull();
  await file(new File(['no'], 'receipt.exe', { type: 'application/octet-stream' }));
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

it.each(['missing', 'rejected'])(
  'allows retry after an attachment upload is %s',
  async (mode) => {
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
    await confirm();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  },
  15_000
);

it('preserves a failed submission and sends trimmed notes on retry', async () => {
  const onSubmitted = vi.fn().mockResolvedValue(undefined);
  await render(onSubmitted);
  await valid();
  await change('bank-name', ' Bank Mellat ');
  await change('note', ' customer note ');
  vi.mocked(submitInvoiceBankReceipt).mockResolvedValueOnce({ ok: false, status: 409 });
  await submit();
  await confirm();
  expect(alert()).not.toBeNull();
  expect(onSubmitted).not.toHaveBeenCalled();
  expect(field('amount').value).toBe('100');
  await submit();
  await confirm();
  expect(submitInvoiceBankReceipt).toHaveBeenLastCalledWith({
    invoiceId: 'invoice-1',
    amountIrR: 100n,
    paymentDate: utcTodayIso(),
    payerReference: 'reference',
    bankName: 'Bank Mellat',
    attachmentKey: 'attachment-key',
    customerNote: 'customer note',
    expectedReviewHash: 'a'.repeat(64),
  });
  expect(onSubmitted).toHaveBeenCalledTimes(1);
  expect(field('amount').value).toBe('');
  expect(field('note').value).toBe('');
  expect(field('bank-name').value).toBe('');
}, 15_000);

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
  expect(loadInvoiceBankReceiptSubmissionReview).toHaveBeenCalledTimes(1);
  expect(submitInvoiceBankReceipt).not.toHaveBeenCalled();
  await confirm();
  expect(submitInvoiceBankReceipt).toHaveBeenCalledTimes(1);
  expect(field('submit').disabled).toBe(false);
}, 15_000);

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

it.each(['review', 'confirm'] as const)(
  'retains a draft and uploaded file after an owned %s field error',
  async (stage) => {
    await render();
    await valid();
    await change('note', 'private note');
    if (stage === 'review')
      vi.mocked(loadInvoiceBankReceiptSubmissionReview).mockResolvedValueOnce({
        kind: 'error',
        status: 400,
        fields: ['payerReference'],
      });
    else
      vi.mocked(submitInvoiceBankReceipt).mockResolvedValueOnce({
        ok: false,
        status: 400,
        fields: ['payerReference'],
      });
    await submit();
    if (stage === 'confirm') await confirm();
    await act(
      async () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    expect(field('payer-ref').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('payer-ref'));
    expect(field('amount').value).toBe('100');
    expect(field('note').value).toBe('private note');
    expect(field('file').files?.[0]?.name).toBe('receipt.pdf');
    expect(field('submit').disabled).toBe(false);
    await change('payer-ref', 'corrected');
    await submit();
    await confirm();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="invoice-receipt-success"]')).not.toBeNull();
  },
  15_000
);

it('reuploads only after the server rejects the cached attachment', async () => {
  await render();
  await valid();
  vi.mocked(loadInvoiceBankReceiptSubmissionReview).mockResolvedValueOnce({
    kind: 'error',
    status: 400,
    fields: ['attachmentKey'],
  });
  await submit();
  await act(
    async () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  expect(document.activeElement).toBe(field('file'));
  expect(field('file').files?.[0]?.name).toBe('receipt.pdf');
  await submit();
  await confirm();
  expect(upload).toHaveBeenCalledTimes(2);
}, 15_000);

it('uses a generic error for protected or unknown server fields', async () => {
  await render();
  await valid();
  vi.mocked(loadInvoiceBankReceiptSubmissionReview).mockResolvedValueOnce({
    kind: 'error',
    status: 400,
    fields: ['payerReference', 'expectedReviewHash'],
  });
  await submit();
  expect(container.querySelector('[data-testid="invoice-receipt-error"]')).not.toBeNull();
  expect(field('payer-ref').getAttribute('aria-invalid')).toBeNull();
});

it.each(['invoice', 'profile'] as const)(
  'clears the previous draft and ignores its late upload when %s changes',
  async (scope) => {
    let finish!: (key: string) => void;
    upload.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finish = resolve;
      })
    );
    await render();
    await valid();
    await submit();
    await act(async () => {
      if (scope === 'invoice') root.render(<InvoiceBankReceiptUploadForm invoiceId="invoice-2" />);
      else refreshProfileContext();
    });
    expect(field('amount').value).toBe('');
    await act(async () => finish('old-profile-key'));
    expect(loadInvoiceBankReceiptSubmissionReview).not.toHaveBeenCalled();
    expect(submitInvoiceBankReceipt).not.toHaveBeenCalled();
  }
);
