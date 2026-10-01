import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button, ListPage } from '@barghsa/ui';
import { useListQuery, type ListQueryBinding } from '../hooks/useListQuery.js';
import { walletHistoryQueryOptions } from '../lib/wallet-history-query.js';
import { WalletHistoryFilters } from './WalletHistoryFilters.js';
import { t, type Locale } from '@barghsa/i18n/app';
import {
  ArrowDownLeft,
  ArrowUpRight,
  LockKeyhole,
  LockKeyholeOpen,
  RotateCcw,
  SlidersHorizontal,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { formatIrr } from '../lib/customer-invoices.js';
import { isInvoiceUuid } from '../lib/invoice-uuid.js';
import type { WalletBankReceiptHistory } from '@barghsa/shared/finance';
import { WalletReceiptHistoryDetails } from './WalletReceiptHistoryDetails.js';
import { useAccountTime } from '../hooks/useAccountTime.js';

const typeIcons: Record<string, LucideIcon> = {
  topup: ArrowDownLeft,
  payment: ArrowUpRight,
  refund: RotateCcw,
  reservation: LockKeyhole,
  release: LockKeyholeOpen,
  reversal: RotateCcw,
  compensating: SlidersHorizontal,
};
interface Transaction {
  bankReceipt?: WalletBankReceiptHistory;
  id: string;
  type: string;
  amount: string;
  state: string;
  refId: string | null;
  description: string | null;
  createdAt: string;
}
interface Page {
  transactions: Transaction[];
  nextCursor: string | null;
}

/** Profile/query ownership prevents obsolete financial history from returning. */
export function WalletTransactionList({
  profileId,
  locale,
  binding,
}: {
  profileId: string;
  locale: Locale;
  binding?: ListQueryBinding;
}) {
  const [raw, setRaw] = useState<Record<string, unknown>>({});
  const local = useListQuery(walletHistoryQueryOptions, raw, (update) => setRaw(update));
  const query = binding ?? local;
  const previousProfile = useRef(profileId);
  useLayoutEffect(() => {
    if (previousProfile.current === profileId) return;
    previousProfile.current = profileId;
    if (query.query.cursor) query.setQuery({ cursor: '' }, true);
  }, [profileId]);
  return <History key={profileId} profileId={profileId} locale={locale} binding={query} />;
}
function History({
  profileId,
  locale,
  binding,
}: {
  profileId: string;
  locale: Locale;
  binding: ListQueryBinding;
}) {
  const id = useId();
  const time = useAccountTime(locale);
  const label = (key: string) => t(`wallet.history.${key}`, locale);
  const params = new URLSearchParams({ sort: binding.query.order });
  if (binding.query.search) params.set('q', binding.query.search);
  for (const key of ['type', 'state', 'from', 'min', 'max']) {
    const value = binding.query.filters[key];
    if (value) params.set(key, value);
  }
  if (binding.query.filters.to) params.set('until', binding.query.filters.to);
  return (
    <section
      className="flex flex-col gap-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {label('title')}
      </h2>
      {time.notice}
      <ListPage>
        <ListPage.Toolbar filters={<WalletHistoryFilters binding={binding} locale={locale} />} />
        <HistoryPage
          profileId={profileId}
          locale={locale}
          filters={params.toString()}
          binding={binding}
          formatTime={time.format}
        />
      </ListPage>
    </section>
  );
}
function HistoryPage({
  profileId,
  locale,
  filters,
  binding,
  formatTime,
}: {
  profileId: string;
  locale: Locale;
  filters: string;
  binding: ListQueryBinding;
  formatTime: ReturnType<typeof useAccountTime>['format'];
}) {
  const criteria = JSON.stringify([profileId, filters]);
  const [accepted, setAccepted] = useState<{ criteria: string; page: Page | null }>({
    criteria,
    page: null,
  });
  const page = accepted.criteria === criteria ? accepted.page : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const cursor = binding.query.cursor;
  const label = (key: string) => t(`wallet.history.${key}`, locale);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const params = new URLSearchParams(filters);
    params.set('limit', '25');
    if (cursor) params.set('cursor', cursor);
    void fetch(`/api/wallet/${encodeURIComponent(profileId)}/transactions?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          if (!controller.signal.aborted && [401, 403, 404].includes(response.status))
            setAccepted({ criteria, page: null });
          throw new Error('History unavailable');
        }
        const data = (await response.json()) as Page;
        if (
          !Array.isArray(data.transactions) ||
          !(data.nextCursor === null || typeof data.nextCursor === 'string')
        )
          throw new Error('Invalid history');
        if (!controller.signal.aborted) setAccepted({ criteria, page: data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [criteria, cursor, attempt]);
  return (
    <>
      <ListPage.Content
        loading={loading}
        error={error}
        empty={!page?.transactions.length}
        retainContent={!!page?.transactions.length}
        loadingView={<p role="status">{label('loading')}</p>}
        errorView={
          <div className="flex flex-col gap-2">
            <p role="alert">{label('error')}</p>
            <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
              {label('retry')}
            </Button>
          </div>
        }
        emptyView={<p>{label('empty')}</p>}
      >
        {page?.transactions.length ? (
          <ol className="divide-y divide-border">
            {page.transactions.map((tx) => {
              const Icon = typeIcons[tx.type] ?? Wallet;
              const amount = BigInt(tx.amount);
              const settled = tx.state === 'Completed';
              const invoiceHref =
                tx.type === 'payment' && tx.refId && isInvoiceUuid(tx.refId)
                  ? `/invoices/${encodeURIComponent(tx.refId)}`
                  : null;
              return (
                <li key={tx.id} className="flex flex-col gap-2 py-4">
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong className="flex items-center gap-2">
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                      {label(`type.${tx.type}`)}
                    </strong>
                    <bdi
                      className={`font-semibold tabular-nums ${settled && amount > 0n ? 'text-success' : settled && amount < 0n ? 'text-destructive' : 'text-foreground'}`}
                    >
                      {amount > 0n ? '+' : ''}
                      {formatIrr(tx.amount, locale)} {label('irr')}
                    </bdi>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <span
                      className={`rounded-full border px-2 py-0.5 ${settled ? 'border-success/30 bg-success-soft text-success' : ['Failed', 'Rejected', 'Reversed'].includes(tx.state) ? 'border-destructive/30 bg-danger-soft text-destructive' : 'border-border bg-muted text-foreground'}`}
                    >
                      {label(`state.${tx.state}`)}
                    </span>
                    <time dateTime={tx.createdAt}>
                      {formatTime(tx.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                    </time>
                  </div>
                  <p className="text-sm text-muted-foreground">{label(`description.${tx.type}`)}</p>
                  {tx.description && (
                    <p className="text-sm" dir="auto">
                      {tx.description}
                    </p>
                  )}
                  {tx.refId && (
                    <p className="break-all text-sm">
                      {label('reference')}:{' '}
                      {invoiceHref ? (
                        <a className="text-primary underline underline-offset-2" href={invoiceHref}>
                          <bdi>
                            {label('viewInvoice')}: {tx.refId}
                          </bdi>
                        </a>
                      ) : (
                        <bdi>{tx.refId}</bdi>
                      )}
                    </p>
                  )}
                  {tx.bankReceipt && (
                    <WalletReceiptHistoryDetails
                      receiptId={tx.id}
                      profileId={profileId}
                      receipt={tx.bankReceipt}
                      locale={locale}
                      formatTime={formatTime}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        ) : null}
      </ListPage.Content>
      <ListPage.Pagination
        kind="cursor"
        label={t('historyPagination.label', locale)}
        hasMore={!error && binding.canAdvance(page?.nextCursor ?? null)}
        loading={loading}
        nextLabel={label('next')}
        onNext={() => binding.next(page?.nextCursor ?? '')}
        previous={{
          enabled: binding.hasPrevious,
          label: label('previous'),
          onClick: binding.previous,
        }}
      />
    </>
  );
}
