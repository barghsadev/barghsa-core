import { Link } from '@tanstack/react-router';
import type { Locale } from '@barghsa/i18n/app';
import { dashboardText } from '@barghsa/i18n/dashboard';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import type { useAccountTime } from '../hooks/useAccountTime.js';

export interface UpcomingInvoice {
  invoiceId: string;
  dueAt: string | null;
  payableFrom: string | null;
  remainingAmount: string;
}

function dayInZone(value: string | number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(typeof value === 'string' ? new Date(value) : value);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
}

function daysUntil(dueAt: string, timezone: string): number | null {
  if (!Number.isFinite(Date.parse(dueAt))) return null;
  return dayInZone(dueAt, timezone) - dayInZone(Date.now(), timezone);
}

export function UpcomingInvoicesWidget({
  invoices,
  locale,
  time,
  embedded = false,
}: {
  invoices: UpcomingInvoice[];
  locale: Locale;
  time: ReturnType<typeof useAccountTime>;
  embedded?: boolean;
}) {
  const Frame = embedded ? 'div' : 'section';
  const now = Date.now();
  const payable = (invoice: UpcomingInvoice) =>
    !invoice.payableFrom || Date.parse(invoice.payableFrom) <= now;
  const payableAmount =
    invoices.length > 1
      ? invoices.reduce(
          (total, invoice) => total + (payable(invoice) ? BigInt(invoice.remainingAmount) : 0n),
          0n
        )
      : 0n;
  return (
    <Frame
      className={embedded ? 'space-y-4' : 'space-y-4 rounded-xl border bg-card p-5'}
      aria-labelledby={embedded ? undefined : 'upcoming-invoices-title'}
    >
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="upcoming-invoices-title" className="text-lg font-semibold">
            {dashboardText('invoice.title', locale)}
          </h2>
          <Link
            to="/invoices"
            search={{ status: 'unpaid' }}
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            {dashboardText('invoice.viewAll', locale)}
          </Link>
        </div>
      )}
      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{dashboardText('invoice.empty', locale)}</p>
      ) : (
        <div className="@container space-y-3">
          {payableAmount > 0n && (
            <dl className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg bg-muted px-3 py-2">
              <dt className="text-sm text-muted-foreground">
                {dashboardText('invoice.payableInList', locale)}
              </dt>
              <dd className="text-base font-semibold wrap-anywhere tabular-nums">
                {formatCurrencyIrr(payableAmount, locale)}
              </dd>
            </dl>
          )}
          <ul className="divide-y">
            {invoices.map((invoice) => {
              const days =
                invoice.dueAt && time.status === 'ready'
                  ? daysUntil(invoice.dueAt, time.timezone)
                  : null;
              const urgency =
                days === null
                  ? null
                  : days < 0
                    ? dashboardText('invoice.overdue', locale)
                    : days === 0
                      ? dashboardText('invoice.dueToday', locale)
                      : dashboardText('invoice.daysRemaining', locale).replace(
                          '{count}',
                          new Intl.NumberFormat(locale).format(days)
                        );
              const canPay = payable(invoice);
              const action = dashboardText(canPay ? 'invoice.payNow' : 'invoice.view', locale);
              return (
                <li
                  key={invoice.invoiceId}
                  className="grid grid-cols-2 items-center gap-x-4 gap-y-2 py-3 first:pt-1 last:pb-1 @min-[38rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_auto] @min-[38rem]:gap-x-6"
                >
                  <p className="min-w-0 text-sm font-medium wrap-anywhere">
                    {dashboardText('invoice.label', locale).replace(
                      '{id}',
                      invoice.invoiceId.slice(0, 8).toUpperCase()
                    )}
                  </p>
                  <p className="min-w-0 text-base font-semibold tabular-nums">
                    <bdi className="wrap-anywhere">
                      {formatCurrencyIrr(invoice.remainingAmount, locale)}
                    </bdi>
                  </p>
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-sm text-muted-foreground">
                      {dashboardText('invoice.dueDate', locale)}:{' '}
                      {time.format(invoice.dueAt, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                    {urgency && (
                      <p
                        className={
                          days !== null && days <= 0
                            ? 'text-sm font-medium text-destructive'
                            : days !== null && days <= 3
                              ? 'text-sm font-medium text-amber-700 dark:text-amber-300'
                              : 'text-sm text-muted-foreground'
                        }
                      >
                        {urgency}
                      </p>
                    )}
                  </div>
                  <Link
                    to="/invoices/$invoiceId"
                    params={{ invoiceId: invoice.invoiceId }}
                    className="inline-flex min-h-11 items-center justify-center justify-self-end rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    aria-label={`${action} · ${invoice.invoiceId}`}
                  >
                    {action}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Frame>
  );
}
