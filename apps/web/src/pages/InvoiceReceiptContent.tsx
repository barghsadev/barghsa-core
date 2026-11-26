import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { StatusBadge } from '@barghsa/ui';
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
    <div className="space-y-4 wrap-anywhere">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-xl font-semibold tabular-nums">
            <bdi>{numbers.money(row.amount)}</bdi>
          </strong>
          <StatusBadge state={row.state === 'Confirmed' ? 'approved' : row.state} label={status} />
        </div>
        <p className="text-muted-foreground">{label(`description.${row.state}`)}</p>
      </div>
      {row.rejectionReason ? (
        <div className="rounded-lg border border-destructive/20 bg-danger-soft p-3">
          <p className="font-medium text-destructive">{label('rejectionReason')}</p>
          <p className="mt-1 text-foreground">{row.rejectionReason}</p>
        </div>
      ) : null}
      <dl className="grid gap-x-5 gap-y-3 border-t pt-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{label('reference')}</dt>
          <dd className="mt-1 font-medium">
            <bdi>{row.payerReference}</bdi>
          </dd>
        </div>
        {row.bankName ? (
          <div>
            <dt className="text-xs text-muted-foreground">{label('bankName')}</dt>
            <dd className="mt-1 font-medium">{row.bankName}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-muted-foreground">{label('paymentDate')}</dt>
          <dd className="mt-1 font-medium">
            <ReceiptDepositDate value={row.paymentDate} locale={locale} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{label('receiptId')}</dt>
          <dd className="mt-1">
            <bdi dir="ltr">{row.id}</bdi>
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">
            {t('invoices.receipts.invoice', locale)}
          </dt>
          <dd className="mt-1">
            <Link
              to="/invoices/$invoiceId"
              params={{ invoiceId }}
              className="touch-action text-primary underline underline-offset-4"
            >
              <bdi dir="ltr">{invoiceId}</bdi>
            </Link>
          </dd>
        </div>
      </dl>
      {row.customerNote ? <p className="whitespace-pre-wrap">{row.customerNote}</p> : null}
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
