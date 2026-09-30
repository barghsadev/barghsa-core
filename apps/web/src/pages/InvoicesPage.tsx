import type { HistoryFilterKey } from '../lib/history-filter-state.js';
import { HistoryFilterPanel } from '../components/HistoryFilterPanel.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { Loader2Icon, ReceiptIcon } from 'lucide-react';
import { useLocale } from '../hooks/useLocale.js';
import { Button, TextFilter, ListSortDropdown, NumberFilter, StatusFilter } from '@barghsa/ui';
import {
  CUSTOMER_INVOICE_STATUSES,
  DEFAULT_INVOICE_LIST_SORT,
  parseNumberRange,
  type InvoiceListQuery,
  type DateRangeFilterValue,
  type NumberRangeValue,
} from '@barghsa/shared/validation';
import { HistoryDateFilter } from '../components/HistoryDateFilter.js';
import { useCursorHistory } from '../hooks/useCursorHistory.js';
import { formatInvoiceServicePeriod } from '../lib/invoice-service-period.js';
import {
  fetchInvoiceList,
  roleI18nKey,
  stateI18nKey,
  type CustomerInvoiceListItem,
} from '../lib/customer-invoices.js';

/** Filtered, paginated invoices for the active profile, including corrections. */
export function InvoicesPage({
  unpaidOnly = false,
  statuses = [],
  onStatusesChange,
  dateRange = {},
  onDateRangeChange,
  query = { q: '', sort: DEFAULT_INVOICE_LIST_SORT },
  onQueryChange,
  onClearFilters,
  onRemoveFilter,
  amountRange = {},
  onAmountRangeChange,
}: {
  unpaidOnly?: boolean;
  statuses?: readonly string[];
  onStatusesChange?: (value: string[]) => void;
  dateRange?: DateRangeFilterValue;
  onDateRangeChange?: (value: DateRangeFilterValue) => void;
  query?: InvoiceListQuery;
  onQueryChange?: (value: InvoiceListQuery) => void;
  onClearFilters?: () => void;
  onRemoveFilter?: (key: HistoryFilterKey, value?: string) => void;
  amountRange?: NumberRangeValue;
  onAmountRangeChange?: (value: NumberRangeValue) => void;
}) {
  const time = useAccountTime();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const isRtl = locale === 'fa';
  const statusOptions: Parameters<typeof StatusFilter>[0]['options'] =
    CUSTOMER_INVOICE_STATUSES.map((value) => ({
      value,
      label: t(stateI18nKey(value), locale),
      tone:
        value === 'Paid' || value === 'Refunded'
          ? 'success'
          : value === 'Cancelled' || value === 'Overdue'
            ? 'destructive'
            : 'warning',
    }));
  const statusesKey = statuses.join(',');
  const { items, before, nextBefore, acceptPage, loadMore } = useCursorHistory<
    CustomerInvoiceListItem & { id: string }
  >(
    `${unpaidOnly}:${statusesKey}:${dateRange.from ?? ''}:${dateRange.to ?? ''}:${query.q}:${query.sort}:${amountRange.min ?? ''}:${amountRange.max ?? ''}`
  );
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const filtered = !!(
    statusesKey ||
    dateRange.from ||
    dateRange.to ||
    query.q ||
    amountRange.min ||
    amountRange.max
  );

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(false);
    fetchInvoiceList(unpaidOnly, {
      before,
      statuses: statusesKey,
      ...dateRange,
      ...query,
      ...amountRange,
      signal: abort.signal,
    })
      .then((page) => {
        if (!abort.signal.aborted)
          acceptPage(
            page.invoices.map((item) => ({ ...item, id: item.invoiceId })),
            page.nextBefore ?? null
          );
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
    };
  }, [
    unpaidOnly,
    statusesKey,
    dateRange.from,
    dateRange.to,
    query.q,
    query.sort,
    amountRange.min,
    amountRange.max,
    before,
    revision,
    acceptPage,
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-5" dir={isRtl ? 'rtl' : 'ltr'}>
      {time.notice}
      <header className="flex items-center gap-2">
        <ReceiptIcon className="h-6 w-6 text-foreground" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('invoices.title', locale)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('invoices.description', locale)}</p>
        </div>
      </header>
      <nav className="flex gap-4 text-sm" aria-label={t('invoices.title', locale)}>
        <Link
          to="/invoices"
          search={{ status: undefined }}
          className="text-primary underline underline-offset-4"
          aria-current={unpaidOnly ? undefined : 'page'}
        >
          {t('invoices.filter.all', locale)}
        </Link>
        <Link
          to="/invoices"
          search={{ status: 'unpaid' }}
          className="text-primary underline underline-offset-4"
          aria-current={unpaidOnly ? 'page' : undefined}
        >
          {t('invoices.filter.unpaid', locale)}
        </Link>
        <Link to="/invoices/receipts" className="text-primary underline underline-offset-4">
          {t('invoices.receipts.title', locale)}
        </Link>
      </nav>

      <HistoryFilterPanel
        query={query}
        statuses={statuses}
        dateRange={dateRange}
        onClear={onClearFilters}
        onRemoveFilter={onRemoveFilter}
        statusOptions={statusOptions}
        formatDate={(value) => time.format(value, { dateStyle: 'medium', timeStyle: 'short' })}
        dateLabel={t('invoices.filter.created', locale)}
        amountRange={amountRange}
      >
        {onQueryChange && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <TextFilter
              value={query.q}
              onChange={(q) => onQueryChange({ ...query, q })}
              label={t('historySearch.label', locale)}
              placeholder={t('invoices.filter.search', locale)}
            />
            <ListSortDropdown
              value={query.sort}
              onChange={(sort) =>
                onQueryChange({ ...query, sort: sort as InvoiceListQuery['sort'] })
              }
              label={t('historySearch.sort', locale)}
              options={(['created_at:desc', 'created_at:asc'] as const).map((value) => ({
                value,
                label: t(
                  value.endsWith('desc') ? 'invoices.filter.newest' : 'invoices.filter.oldest',
                  locale
                ),
              }))}
            />
          </div>
        )}
        {onDateRangeChange && (
          <HistoryDateFilter
            value={dateRange}
            onChange={onDateRangeChange}
            locale={locale}
            time={time}
            label={t('invoices.filter.created', locale)}
          />
        )}
        {onAmountRangeChange && (
          <NumberFilter
            value={amountRange}
            onChange={onAmountRangeChange}
            parseRange={parseNumberRange}
            labels={{
              label: t('invoices.filter.amount', locale),
              min: t('invoices.filter.min', locale),
              max: t('invoices.filter.max', locale),
              apply: t('invoices.filter.applyAmount', locale),
              clear: t('invoices.filter.clearAmount', locale),
              invalid: t('invoices.filter.invalidAmount', locale),
            }}
          />
        )}
        {onStatusesChange && (
          <StatusFilter
            label={t('invoices.filter.state', locale)}
            clearLabel={t('invoices.filter.clearState', locale)}
            countLabel={numbers.number(statuses.length)}
            value={statuses}
            onChange={onStatusesChange}
            options={statusOptions}
          />
        )}
      </HistoryFilterPanel>

      {loading ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('invoices.loading', locale)}
        </p>
      ) : error ? (
        <div className="space-y-2" role="alert">
          <p className="text-destructive">{t('invoices.error.load', locale)}</p>
          <Button onClick={() => setRevision((value) => value + 1)}>
            {t('invoices.filter.retry', locale)}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-input bg-card text-card-foreground p-8 text-center text-sm text-muted-foreground">
          {t(
            filtered
              ? 'historyDates.empty'
              : unpaidOnly
                ? 'invoices.filter.unpaidEmpty'
                : 'invoices.empty',
            locale
          )}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.invoiceId}>
              <Link
                to="/invoices/$invoiceId"
                params={{ invoiceId: item.invoiceId }}
                className="block rounded-lg border border-border bg-card text-card-foreground p-4 shadow-sm hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">{t(roleI18nKey(item.role), locale)}</p>
                  <p className="text-sm text-muted-foreground">
                    {t(stateI18nKey(item.state), locale)}
                  </p>
                </div>
                <p className="mt-2 text-lg font-semibold text-foreground">
                  {numbers.money(item.totalAmount)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('invoices.list.reference', locale)}:{' '}
                  <bdi dir="ltr" className="break-all font-mono">
                    {item.invoiceId}
                  </bdi>
                </p>
                {item.paidAmount !== undefined ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('invoices.list.paid', locale)}: {numbers.money(item.paidAmount)}
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('invoices.list.issued', locale)}: {time.format(item.issuedAt)}
                </p>
                {item.dueAt && (
                  <p className="text-sm text-muted-foreground">
                    {t('invoices.list.due', locale)}: {time.format(item.dueAt)}
                  </p>
                )}
                {item.periodStart && item.periodEnd ? (
                  <p className="text-sm text-muted-foreground">
                    {t('invoices.list.period', locale)}:{' '}
                    {formatInvoiceServicePeriod(item.periodStart, item.periodEnd, time.format)}
                  </p>
                ) : null}
                {item.explanation ? (
                  <p className="mt-2 text-sm text-foreground">{item.explanation}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {nextBefore && !error && (
        <Button variant="outline" disabled={loading} onClick={loadMore}>
          {t('invoices.filter.more', locale)}
        </Button>
      )}
    </div>
  );
}
