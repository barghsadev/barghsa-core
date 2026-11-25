import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { ReceiptStatusTimeline } from '../components/ReceiptStatusTimeline.js';
import { ReceiptAttachmentPreview } from '../components/ReceiptAttachmentPreview.js';
import { ReceiptDepositDate } from '../components/ReceiptDepositDate.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import type { InvoiceReceiptActivity } from '../lib/customer-invoices.js';

export function InvoiceReceiptContent({
  invoiceId,
  row,
  initiallyOpen,
  formatTimestamp,
  headingLevel: Heading = 'h3',
}: {
  invoiceId: string;
  row: InvoiceReceiptActivity;
  initiallyOpen: boolean;
  formatTimestamp: (value: string | null) => string;
  headingLevel?: 'h2' | 'h3';
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`invoices.activity.${key}`, locale);
  const stateKey = `invoices.activity.state.${row.state}`;
  const state = t(stateKey, locale);
  const status = state === stateKey ? label('state.Unknown') : state;
  return (
    <div className="space-y-3 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap justify-between gap-2">
        <span>{status}</span>
        <strong className="tabular-nums">{numbers.money(row.amount)}</strong>
      </div>
      <p className="text-muted-foreground">{label(`description.${row.state}`)}</p>
      <p>
        {label('receiptId')}: <bdi className="break-all">{row.id}</bdi>
      </p>
      <p>
        {label('reference')}: <bdi>{row.payerReference}</bdi>
      </p>
      <p>
        {t('invoices.receipts.invoice', locale)}:{' '}
        <Link
          to="/invoices/$invoiceId"
          params={{ invoiceId: invoiceId }}
          className="touch-action break-all text-primary underline underline-offset-4"
        >
          <bdi dir="ltr">{invoiceId}</bdi>
        </Link>
      </p>
      {row.bankName ? (
        <p>
          {label('bankName')}: {row.bankName}
        </p>
      ) : null}
      <p>
        {label('paymentDate')}: <ReceiptDepositDate value={row.paymentDate} locale={locale} />
      </p>
      {row.customerNote ? <p>{row.customerNote}</p> : null}
      {row.rejectionReason ? (
        <p className="text-destructive">
          {label('rejectionReason')}: {row.rejectionReason}
        </p>
      ) : null}
      <ReceiptAttachmentPreview
        key={`${invoiceId}:${row.id}`}
        invoiceId={invoiceId}
        receiptId={row.id}
        initiallyOpen={initiallyOpen}
      />
      <a
        href={`/api/invoices/${encodeURIComponent(invoiceId)}/bank-receipts/${encodeURIComponent(row.id)}/attachment`}
        target="_blank"
        rel="noopener noreferrer"
        className="touch-action text-primary underline underline-offset-4"
      >
        {label('viewReceiptAttachment')}
      </a>
      {row.statusHistory?.length ? (
        <section aria-label={`${label('reviewTimeline')}: ${row.id}`} className="pt-2">
          <Heading className="mb-2 font-medium">{label('reviewTimeline')}</Heading>
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
    </div>
  );
}
