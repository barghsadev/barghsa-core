import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button, ListPage, ListViewToggle, type ListView } from '@barghsa/ui';
import { useListQuery, type ListQueryBinding } from '../hooks/useListQuery.js';
import { walletHistoryQueryOptions } from '../lib/wallet-history-query.js';
import { WalletHistoryFilters } from './WalletHistoryFilters.js';
import { t, type Locale } from '@barghsa/i18n/app';
import { WalletTransactionRecords, type WalletTransaction } from './WalletTransactionRecords.js';
import { useListView } from '../hooks/useListView.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';

interface Page {
  transactions: WalletTransaction[];
  nextCursor: string | null;
}

/** Profile/query ownership prevents obsolete financial history from returning. */
export function TransactionList({
  profileId,
  locale,
  binding,
  staff = false,
}: {
  profileId: string;
  locale: Locale;
  binding?: ListQueryBinding;
  staff?: boolean;
}) {
  const [raw, setRaw] = useState<Record<string, unknown>>({});
  const local = useListQuery(walletHistoryQueryOptions, raw, (update) => setRaw(update));
  const query = binding ?? local;
  const account = useAccountUser();
  const revision = useProfileContextRevision();
  const owner = JSON.stringify([account, revision, profileId, staff]);
  const previousOwner = useRef(owner);
  const resettingCursor = previousOwner.current !== owner && !!query.query.cursor;
  useLayoutEffect(() => {
    if (previousOwner.current === owner) return;
    if (query.query.cursor) query.setQuery({ cursor: '', search: query.query.search }, true);
    else previousOwner.current = owner;
  }, [owner, query.query.cursor]);
  return resettingCursor ? null : (
    <History key={owner} profileId={profileId} locale={locale} binding={query} staff={staff} />
  );
}
export { TransactionList as WalletTransactionList };
function History({
  profileId,
  locale,
  binding,
  staff,
}: {
  profileId: string;
  locale: Locale;
  binding: ListQueryBinding;
  staff: boolean;
}) {
  const id = useId();
  const { view, setView } = useListView(
    staff ? 'staff-wallet-transactions' : 'customer-wallet-transactions'
  );
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
          staff={staff}
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
  staff,
}: {
  profileId: string;
  locale: Locale;
  filters: string;
  binding: ListQueryBinding;
  formatTime: ReturnType<typeof useAccountTime>['format'];
  view: ListView;
  staff: boolean;
}) {
  const criteria = JSON.stringify([profileId, filters, staff]);
  const [accepted, setAccepted] = useState<{ criteria: string; page: Page | null }>({
    criteria,
    page: null,
  });
  const page = accepted.criteria === criteria ? accepted.page : null;
  const [attempt, setAttempt] = useState(0);
  const cursor = binding.query.cursor;
  const revision = useProfileContextRevision();
  const requestScope = JSON.stringify([criteria, cursor, attempt, revision]);
  const currentRequest = useRef(requestScope);
  currentRequest.current = requestScope;
  const [read, setRead] = useState({
    scope: requestScope,
    status: 'loading' as 'loading' | 'ready' | 'error' | 'denied',
  });
  const status = read.scope === requestScope ? read.status : 'loading';
  const loading = status === 'loading';
  const error = status === 'error' || status === 'denied';
  const label = (key: string) => t(`wallet.history.${key}`, locale);
  useEffect(() => {
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted &&
      currentRequest.current === requestScope &&
      getProfileContextRevision() === revision;
    setRead({ scope: requestScope, status: 'loading' });
    const params = new URLSearchParams(filters);
    params.set('limit', '25');
    if (cursor) params.set('cursor', cursor);
    const endpoint = staff ? '/api/admin/reconciliation/wallets' : '/api/wallet';
    void fetch(`${endpoint}/${encodeURIComponent(profileId)}/transactions?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!current()) return;
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) {
            setAccepted({ criteria, page: null });
            setRead({ scope: requestScope, status: 'denied' });
            return;
          }
          throw new Error('History unavailable');
        }
        const data = (await response.json()) as Page & { profileId?: string };
        if (!current()) return;
        if (
          !Array.isArray(data.transactions) ||
          (staff && data.profileId !== profileId) ||
          !(data.nextCursor === null || typeof data.nextCursor === 'string')
        )
          throw new Error('Invalid history');
        setAccepted({ criteria, page: data });
        setRead({ scope: requestScope, status: 'ready' });
      })
      .catch(() => {
        if (current()) setRead({ scope: requestScope, status: 'error' });
      });
    return () => controller.abort();
  }, [requestScope]);
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
            <p role="alert">
              {status === 'denied' ? t('historyPagination.accessDenied', locale) : label('error')}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                if (
                  currentRequest.current !== requestScope ||
                  getProfileContextRevision() !== revision
                )
                  return;
                if (status === 'denied' && cursor) {
                  binding.setQuery({ cursor: '', search: binding.query.search }, true);
                  return;
                }
                setAttempt((value) => value + 1);
              }}
            >
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
            staff={staff}
          />
        ) : null}
      </ListPage.Content>
      {status !== 'denied' && (
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
      )}
    </>
  );
}
