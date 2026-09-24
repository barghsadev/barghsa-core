import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Loader2Icon, ReceiptText } from 'lucide-react';
import { Button } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  fetchBankReceiptPage,
  type CustomerBankReceiptListItem,
  type CustomerBankReceiptPage,
} from '../lib/customer-invoices.js';

type StateFilter = CustomerBankReceiptListItem['state'] | '';

export function BankReceiptsPage() {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const [state, setState] = useState<StateFilter>('');
  const [items, setItems] = useState<CustomerBankReceiptListItem[]>([]);
  const [cursor, setCursor] = useState<CustomerBankReceiptPage['nextCursor']>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [revision, setRevision] = useState(0);
  const moreRequest = useRef<AbortController | null>(null);
  const label = (key: string) => t(`invoices.receipts.${key}`, locale);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-US', {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }),
    [locale]
  );

  useEffect(() => {
    const request = new AbortController();
    moreRequest.current?.abort();
    setLoadState('loading');
    setItems([]);
    setCursor(null);
    setLoadingMore(false);
    setMoreError(false);
    void fetchBankReceiptPage({ ...(state ? { state } : {}), signal: request.signal })
      .then((page) => {
        if (request.signal.aborted) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setLoadState('ready');
      })
      .catch(() => {
        if (!request.signal.aborted) setLoadState('error');
      });
    return () => {
      request.abort();
      moreRequest.current?.abort();
    };
  }, [state, revision]);

  function loadMore() {
    if (!cursor || loadingMore) return;
    const request = new AbortController();
    moreRequest.current = request;
    setLoadingMore(true);
    setMoreError(false);
    void fetchBankReceiptPage({
      ...(state ? { state } : {}),
      cursor,
      signal: request.signal,
    })
      .then((page) => {
        if (request.signal.aborted) return;
        setItems((current) => [...current, ...page.items]);
        setCursor(page.nextCursor);
      })
      .catch(() => {
        if (!request.signal.aborted) setMoreError(true);
      })
      .finally(() => {
        if (!request.signal.aborted) setLoadingMore(false);
      });
  }

  const paymentDate = (value: string) => dateFormatter.format(new Date(`${value}T00:00:00Z`));

  return (
    <div className="mx-auto max-w-3xl space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <ReceiptText className="h-6 w-6" aria-hidden="true" />
          <h1 className="text-2xl font-bold">{label('title')}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{label('description')}</p>
      </header>
      <nav aria-label={label('title')} className="text-sm">
        <Link
          to="/invoices"
          search={{ status: undefined }}
          className="text-primary underline underline-offset-4"
        >
          {label('backToInvoices')}
        </Link>
      </nav>
      <div className="space-y-2">
        <label htmlFor="bank-receipt-state" className="text-sm font-medium">
          {label('filter')}
        </label>
        <select
          id="bank-receipt-state"
          value={state}
          onChange={(event) => setState(event.target.value as StateFilter)}
          className="block min-h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">{label('all')}</option>
          {(['Submitted', 'UnderReview', 'Confirmed', 'Rejected'] as const).map((value) => (
            <option key={value} value={value}>
              {t(`invoices.activity.state.${value}`, locale)}
            </option>
          ))}
        </select>
      </div>
      {loadState === 'loading' ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
          {label('loading')}
        </p>
      ) : null}
      {loadState === 'error' ? (
        <div className="space-y-2">
          <p role="alert">{label('error')}</p>
          <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
            {label('retry')}
          </Button>
        </div>
      ) : null}
      {loadState === 'ready' && items.length === 0 ? <p>{label('empty')}</p> : null}
      {items.length ? (
        <ul className="divide-y divide-border border-y border-border">
          {items.map((item) => (
            <li key={item.receiptId} className="py-4">
              <Link
                to="/invoices/$invoiceId"
                params={{ invoiceId: item.invoiceId }}
                hash={`bank-receipt-${item.receiptId}`}
                className="group block space-y-2 rounded-md p-2 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-base">{numbers.money(item.amount)}</strong>
                  <span className="text-sm font-medium">
                    {t(`invoices.activity.state.${item.state}`, locale)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {label('invoice')}:{' '}
                  <bdi dir="ltr" className="break-all">
                    {item.invoiceId}
                  </bdi>
                </p>
                <p className="text-sm text-muted-foreground">
                  {label('receipt')}:{' '}
                  <bdi dir="ltr" className="break-all">
                    {item.receiptId}
                  </bdi>
                </p>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                  <span>
                    {label('bank')}: {item.bankName ?? label('bankUnknown')}
                  </span>
                  <span>
                    {label('depositDate')}: {paymentDate(item.paymentDate)}
                  </span>
                  <span>
                    {label('submittedAt')}: {time.format(item.submittedAt)}
                  </span>
                </div>
                <span className="text-sm text-primary underline underline-offset-4 group-hover:no-underline">
                  {label('openDetail')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {moreError ? <p role="alert">{label('moreError')}</p> : null}
      {cursor && loadState === 'ready' ? (
        <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? label('loading') : label('older')}
        </Button>
      ) : null}
    </div>
  );
}
