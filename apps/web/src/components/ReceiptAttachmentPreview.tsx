import { useState } from 'react';
import { Button } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';

/** Request private image bytes only when the customer opens the receipt preview. */
export function ReceiptAttachmentPreview({
  invoiceId,
  profileId,
  locale: localeOverride,
  receiptId,
  initiallyOpen = false,
}: {
  receiptId: string;
  initiallyOpen?: boolean;
  locale?: Locale;
} & ({ invoiceId: string; profileId?: never } | { profileId: string; invoiceId?: never })) {
  const currentLocale = useLocale();
  const locale = localeOverride ?? currentLocale;
  const [open, setOpen] = useState(initiallyOpen);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const label = (key: string) => t(`invoices.activity.${key}`, locale);
  const base =
    invoiceId !== undefined
      ? `/api/invoices/${encodeURIComponent(invoiceId)}/bank-receipts`
      : `/api/wallet/${encodeURIComponent(profileId)}/bank-receipt-top-ups`;
  const path = `${base}/${encodeURIComponent(receiptId)}/preview`;
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-lg border border-border p-3"
    >
      <summary className="min-h-11 cursor-pointer content-center font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        {label('receiptPreview')}
      </summary>
      {open && (
        <figure className="mt-2 space-y-2">
          {state === 'error' ? (
            <div className="space-y-2">
              <p role="status" className="text-muted-foreground">
                {label('previewUnavailable')}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setState('loading');
                  setRevision((value) => value + 1);
                }}
              >
                {label('retry')}
              </Button>
            </div>
          ) : (
            <>
              {state === 'loading' && (
                <p role="status" className="text-muted-foreground">
                  {label('previewLoading')}
                </p>
              )}
              <img
                key={revision}
                src={`${path}?revision=${revision}`}
                alt={label('receiptPreviewAlt').replace('{receipt}', receiptId)}
                width={640}
                height={640}
                className="max-h-96 w-full rounded-md bg-muted object-contain"
                onLoad={() => setState('ready')}
                onError={() => setState('error')}
              />
            </>
          )}
          <figcaption className="text-xs text-muted-foreground">
            {label('previewDescription')}
          </figcaption>
        </figure>
      )}
    </details>
  );
}
