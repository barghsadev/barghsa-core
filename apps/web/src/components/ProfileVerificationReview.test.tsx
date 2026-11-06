import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfileVerificationReview } from './ProfileVerificationReview.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../lib/invoice-bank-receipt-upload.js', () => ({
  uploadVerificationEvidence: vi.fn(),
  isAllowedInvoiceReceiptFile: () => true,
  INVOICE_BANK_RECEIPT_FILE_ACCEPT: '.pdf',
}));
import { uploadVerificationEvidence } from '../lib/invoice-bank-receipt-upload.js';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    onReview = vi.fn();
  await act(async () =>
    root.render(
      <ProfileVerificationReview
        profileId="profile-one"
        status="VERIFIED"
        title="Customer"
        current={false}
        policy={{
          required: true,
          documents: ['national_id'],
          expiryDays: 30,
          allowManualOverride: true,
        }}
        canOverride
        disabled={false}
        onReview={onReview}
      />
    )
  );
  return {
    host,
    onReview,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
const button = (host: HTMLElement) => host.querySelector('button')!;
async function selectFile(host: HTMLElement) {
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', {
    value: [new File(['%PDF-1.4'], 'identity.pdf', { type: 'application/pdf' })],
  });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
it('retains selected evidence after an upload failure and captures its type/profile only after verification succeeds', async () => {
  const view = await mount();
  try {
    await act(async () => button(view.host).click());
    expect(view.onReview).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(view.host.querySelector('input[type=file]'));
    await selectFile(view.host);
    vi.mocked(uploadVerificationEvidence).mockResolvedValueOnce(null);
    await act(async () => button(view.host).click());
    expect(view.onReview).not.toHaveBeenCalled();
    expect(view.host.querySelector<HTMLInputElement>('input[type=file]')!.files).toHaveLength(1);
    vi.mocked(uploadVerificationEvidence).mockResolvedValueOnce('uploads/document/verified.pdf');
    await act(async () => button(view.host).click());
    expect(uploadVerificationEvidence).toHaveBeenLastCalledWith(expect.any(File), 'profile-one');
    expect(view.onReview).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          action: 'verify',
          evidence: [{ type: 'national_id', key: 'uploads/document/verified.pdf' }],
        },
      })
    );
  } finally {
    await view.close();
  }
});
it('locks duplicate preparation and refuses to propose a review after its profile scope unmounts', async () => {
  const view = await mount();
  await selectFile(view.host);
  let release!: (value: string) => void;
  vi.mocked(uploadVerificationEvidence).mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  await act(async () => {
    button(view.host).click();
    button(view.host).click();
  });
  expect(uploadVerificationEvidence).toHaveBeenCalledTimes(1);
  expect(button(view.host).matches(':disabled')).toBe(true);
  await view.close();
  await act(async () => release('uploads/document/obsolete.pdf'));
  expect(view.onReview).not.toHaveBeenCalled();
});
it('exposes renewal and requires an explicit reason for a permitted document override', async () => {
  const view = await mount();
  try {
    expect(view.host.querySelector('select')!.value).toBe('verify');
    await act(async () =>
      view.host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click()
    );
    await act(async () => button(view.host).click());
    expect(view.onReview).not.toHaveBeenCalled();
    const reason = view.host.querySelector<HTMLTextAreaElement>('#verification-override-reason')!;
    expect(document.activeElement).toBe(reason);
    expect(reason.getAttribute('aria-invalid')).toBe('true');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        reason,
        '  Original checked in person  '
      );
      reason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button(view.host).click());
    expect(uploadVerificationEvidence).not.toHaveBeenCalled();
    expect(view.onReview).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { action: 'verify', overrideReason: 'Original checked in person' },
      })
    );
  } finally {
    await view.close();
  }
});
