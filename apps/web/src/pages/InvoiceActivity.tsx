import { t } from '@barghsa/i18n/app';
import type { ReactNode } from 'react';
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
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`invoices.activity.${key}`, locale);
  const state = (value: string) => label(`state.${value}`);
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
          <li key={row.id} className={rowClass}>
            <div className="flex flex-wrap justify-between gap-2">
              <span>{state(row.state)}</span>
              <strong>{numbers.money(row.amount)}</strong>
            </div>
            <p className="text-muted-foreground">{label(`description.${row.state}`)}</p>
            <p>
              {label('reference')}: <bdi>{row.payerReference}</bdi>
            </p>
            <p>
              {label('paymentDate')}: <bdi>{row.paymentDate}</bdi>
            </p>
            {row.customerNote ? <p>{row.customerNote}</p> : null}
            {row.rejectionReason ? (
              <p className="text-destructive">
                {label('rejectionReason')}: {row.rejectionReason}
              </p>
            ) : null}
            <p className="text-muted-foreground">{formatTimestamp(row.createdAt)}</p>
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
