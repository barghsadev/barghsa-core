import { ReceiptStatusTimeline } from '../components/ReceiptStatusTimeline.js';
import { t } from '@barghsa/i18n/app';
import { Link } from '@tanstack/react-router';
import { ReceiptAttachmentPreview } from '../components/ReceiptAttachmentPreview.js';
import { useEffect, type ReactNode } from 'react';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import type { CustomerInvoiceDetails } from '../lib/customer-invoices.js';

export function InvoiceActivity({
  details,
  formatTimestamp,
}: {
  details: CustomerInvoiceDetails;
  formatTimestamp: (value: string | null) => string;
}) {
  const locale = useLocale();
  useEffect(() => {
    const targetId = window.location.hash.slice(1);
    if (!details.bankReceipts?.some((receipt) => targetId === `bank-receipt-${receipt.id}`)) return;
    document.getElementById(targetId)?.scrollIntoView?.({ block: 'start' });
  }, [details.bankReceipts]);
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`invoices.activity.${key}`, locale);
  const state = (value: string) => {
    const key = `invoices.activity.state.${value}`;
    const text = t(key, locale);
    return text === key ? label('state.Unknown') : text;
  };
  const section = (key: string, rows: ReactNode[]) => (
    <section aria-labelledby={`invoice-${key}-heading`} className="space-y-3">
      <h2 id={`invoice-${key}-heading`} className="text-lg font-semibold">
        {label(key)}
      </h2>
      {rows.length ? (
        <ul className="space-y-2">{rows}</ul>
      ) : (
        <p className="text-sm text-muted-foreground">{label(`${key}Empty`)}</p>
      )}
    </section>
  );
  const rowClass =
    'rounded-lg border border-border bg-card p-4 text-sm text-card-foreground space-y-2 break-words';
  return (
    <div className="space-y-6" data-testid="invoice-activity">
      <p className="text-sm text-muted-foreground">{label('scope')}</p>
      {section(
        'payments',
        (details.payments ?? []).map((row) => (
          <li key={`${row.source}-${row.id}`} className={rowClass}>
            <div className="flex flex-wrap justify-between gap-2">
              <span>{label(row.source)}</span>
              <strong>{numbers.money(row.amount)}</strong>
            </div>
            <p>{state(row.state)}</p>
            <p className="text-muted-foreground">{label(`description.${row.state}`)}</p>
            <p className="text-muted-foreground">{formatTimestamp(row.createdAt)}</p>
          </li>
        ))
      )}
      {section(
        'receipts',
        (details.bankReceipts ?? []).map((row) => (
          <li key={row.id} id={`bank-receipt-${row.id}`} className={`${rowClass} scroll-mt-24`}>
            <div className="flex flex-wrap justify-between gap-2">
              <span>{state(row.state)}</span>
              <strong>{numbers.money(row.amount)}</strong>
            </div>
            <p className="text-muted-foreground">{label(`description.${row.state}`)}</p>
            <p>
              {label('receiptId')}: <bdi>{row.id}</bdi>
            </p>
            <p>
              {label('reference')}: <bdi>{row.payerReference}</bdi>
            </p>
            <p>
              {t('invoices.receipts.invoice', locale)}:{' '}
              <Link
                to="/invoices/$invoiceId"
                params={{ invoiceId: details.viewedInvoiceId }}
                className="text-primary underline underline-offset-4"
              >
                <bdi dir="ltr">{details.viewedInvoiceId}</bdi>
              </Link>
            </p>
            {row.bankName ? (
              <p>
                {label('bankName')}: {row.bankName}
              </p>
            ) : null}
            <p>
              {label('paymentDate')}: <bdi>{row.paymentDate}</bdi>
            </p>
            {row.customerNote ? <p>{row.customerNote}</p> : null}
            {row.rejectionReason ? (
              <p className="text-destructive">
                {label('rejectionReason')}: {row.rejectionReason}
              </p>
            ) : null}
            <ReceiptAttachmentPreview
              key={`${details.viewedInvoiceId}:${row.id}`}
              invoiceId={details.viewedInvoiceId}
              receiptId={row.id}
              initiallyOpen={window.location.hash === `#bank-receipt-${row.id}`}
            />
            <a
              href={`/api/invoices/${encodeURIComponent(details.viewedInvoiceId)}/bank-receipts/${encodeURIComponent(row.id)}/attachment`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-primary underline underline-offset-4"
            >
              {label('viewReceiptAttachment')}
            </a>
            {row.statusHistory?.length ? (
              <section aria-label={`${label('reviewTimeline')}: ${row.id}`} className="pt-2">
                <h3 className="mb-2 font-medium">{label('reviewTimeline')}</h3>
                <ReceiptStatusTimeline
                  history={row.statusHistory}
                  label={label('reviewTimeline')}
                  locale={locale}
                  formatTimestamp={formatTimestamp}
                />
              </section>
            ) : (
              <>
                <p className="text-muted-foreground">
                  {label('submittedAt')}: {formatTimestamp(row.createdAt)}
                </p>
                {row.confirmedAt ? (
                  <p className="text-muted-foreground">
                    {label('confirmedAt')}: {formatTimestamp(row.confirmedAt)}
                  </p>
                ) : null}
              </>
            )}
          </li>
        ))
      )}
      {section(
        'refunds',
        (details.refunds ?? []).map((row) => (
          <li key={row.id} className={rowClass}>
            <div className="flex flex-wrap justify-between gap-2">
              <span>{label(row.destination)}</span>
              <strong>{numbers.money(row.amount)}</strong>
            </div>
            <p>{state(row.state)}</p>
            <p className="text-muted-foreground">{label(`description.${row.state}`)}</p>
            <p className="text-muted-foreground">{formatTimestamp(row.updatedAt)}</p>
          </li>
        ))
      )}
    </div>
  );
}
