import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ReceiptAttachmentPreview } from './ReceiptAttachmentPreview.js';
import { t } from '@barghsa/i18n/app';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it.each(['en', 'fa'] as const)(
  'loads only opened wallet previews and offers a scoped retry (%s)',
  async (locale) => {
    await act(async () =>
      root.render(
        <ReceiptAttachmentPreview profileId="profile/a" receiptId="receipt?one" locale={locale} />
      )
    );
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('summary')?.textContent).toBe(
      t('invoices.activity.receiptPreview', locale)
    );
    const details = host.querySelector('details')!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event('toggle', { bubbles: true }));
    });
    let image = host.querySelector('img')!;
    expect(image.getAttribute('src')).toBe(
      '/api/wallet/profile%2Fa/bank-receipt-top-ups/receipt%3Fone/preview?revision=0'
    );
    expect(image.getAttribute('alt')).toBe(
      t('invoices.activity.receiptPreviewAlt', locale).replace('{receipt}', 'receipt?one')
    );
    await act(async () => image.dispatchEvent(new Event('error')));
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain(t('invoices.activity.previewUnavailable', locale));
    await act(async () => host.querySelector('button')!.click());
    image = host.querySelector('img')!;
    expect(image.getAttribute('src')).toContain('receipt%3Fone/preview?revision=1');
    await act(async () => image.dispatchEvent(new Event('load')));
    expect(host.querySelector('[role=status]')).toBeNull();
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event('toggle', { bubbles: true }));
    });
    expect(host.querySelector('img')).toBeNull();
  }
);

it('preserves the invoice endpoint and selected-receipt behavior', async () => {
  await act(async () =>
    root.render(
      <ReceiptAttachmentPreview
        invoiceId="invoice/a"
        receiptId="receipt?two"
        initiallyOpen
        locale="en"
      />
    )
  );
  expect(host.querySelector('details')?.open).toBe(true);
  expect(host.querySelector('img')?.getAttribute('src')).toBe(
    '/api/invoices/invoice%2Fa/bank-receipts/receipt%3Ftwo/preview?revision=0'
  );
});
