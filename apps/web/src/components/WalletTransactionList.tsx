import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button, ListPage, ListViewToggle, type ListView } from '@barghsa/ui';
import { useListQuery, type ListQueryBinding } from '../hooks/useListQuery.js';
import { walletHistoryQueryOptions } from '../lib/wallet-history-query.js';
import { WalletHistoryFilters } from './WalletHistoryFilters.js';
import { t, type Locale } from '@barghsa/i18n/app';
import { WalletTransactionRecords, type WalletTransaction } from './WalletTransactionRecords.js';
import { useListView } from '../hooks/useListView.js';
import { useAccountTime } from '../hooks/useAccountTime.js';

interface Page {
  transactions: WalletTransaction[];
  nextCursor: string | null;
}

/** Profile/query ownership prevents obsolete financial history from returning. */
export function TransactionList({
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
export { TransactionList as WalletTransactionList };
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
  const { view, setView } = useListView('customer-wallet-transactions');
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
        <ListPage.Toolbar
          filters={<WalletHistoryFilters binding={binding} locale={locale} />}
          actions={
            <ListViewToggle
              value={view}
              onChange={setView}
              labels={{
                group: t('historyView.group', locale),
                table: t('historyView.table', locale),
                card: t('historyView.card', locale),
              }}
            />
          }
        />
        <HistoryPage
          profileId={profileId}
          locale={locale}
          filters={params.toString()}
          binding={binding}
          formatTime={time.format}
          view={view}
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
  view,
}: {
  profileId: string;
  locale: Locale;
  filters: string;
  binding: ListQueryBinding;
  formatTime: ReturnType<typeof useAccountTime>['format'];
  view: ListView;
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
          <WalletTransactionRecords
            key={criteria}
            items={page.transactions}
            view={view}
            profileId={profileId}
            locale={locale}
            formatTime={formatTime}
          />
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
