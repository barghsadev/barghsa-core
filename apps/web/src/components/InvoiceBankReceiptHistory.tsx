import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, ListPage, ListViewToggle, PageLoading } from '@barghsa/ui';
import { tWorkspace as adminText } from '@barghsa/i18n/workspace-admin';
import { t as appText } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';
import { useListView } from '../hooks/useListView.js';
import { StaffInvoiceReceiptList } from './StaffInvoiceReceiptList.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';

import { useListQuery, type ListQueryBinding } from '../hooks/useListQuery.js';
import { InvoiceReceiptHistoryFilters } from './InvoiceReceiptHistoryFilters.js';
import {
  decodeFinanceCursor,
  encodeFinanceCursor,
  invoiceReceiptQueryOptions,
} from '../lib/finance-list-query.js';

interface HistoryItem {
  receiptId: string;
  invoiceId: string;
  amount: string;
  bankName: string | null;
  state: 'Confirmed' | 'Rejected';
  paymentDate: string;
  submittedAt: string;
}
interface Cursor {
  beforeAt: string;
  beforeId: string;
}
interface HistoryPage {
  items: HistoryItem[];
  nextCursor: Cursor | null;
}

export function InvoiceBankReceiptHistory({
  onOpen,
  revision,
  binding,
}: {
  onOpen: (receiptId: string) => void;
  revision: number;
  binding?: ListQueryBinding;
}) {
  const locale = useLocale();
  const { view, setView } = useListView('staff-invoice-receipts-history');
  const word = (key: string) => adminText(`admin.invoiceReceipts.${key}`, locale);
  const [raw, setRaw] = useState<Record<string, unknown>>({});
  const local = useListQuery(invoiceReceiptQueryOptions, raw, (update) => setRaw(update));
  const queryBinding = binding ?? local;
  const { query } = queryBinding;
  const state = query.filters.state ?? '';
  const [invoiceInput, setInvoiceInput] = useState('');
  const invoiceId = query.filters.invoiceId ?? '';
  const [invalidInvoice, setInvalidInvoice] = useState(false);
  const cursor = useMemo(() => decodeFinanceCursor(query.cursor), [query.cursor]);
  const cursorKey = encodeFinanceCursor(cursor);
  const [retryRevision, setRetryRevision] = useState(0);
  const criteria = JSON.stringify([query.search, query.order, query.filters]);
  const [accepted, setAccepted] = useState({
    criteria,
    page: { items: [], nextCursor: null } as HistoryPage,
  });
  const page = accepted.criteria === criteria ? accepted.page : { items: [], nextCursor: null };
  const setPage = (page: HistoryPage) => setAccepted({ criteria, page });
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>(
    'loading'
  );

  useEffect(() => {
    setInvoiceInput(invoiceId);
    setInvalidInvoice(false);
  }, [invoiceId]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (state) query.set('state', state);
    if (invoiceId) query.set('invoiceId', invoiceId);
    if (queryBinding.query.search) query.set('q', queryBinding.query.search);
    if (queryBinding.query.order !== 'desc')
      query.set('sort', `submitted_at:${queryBinding.query.order}`);
    for (const key of ['from', 'to', 'min', 'max']) {
      const value = queryBinding.query.filters[key];
      if (value) query.set(key, value);
    }
    if (cursor) {
      query.set('beforeAt', cursor.beforeAt);
      query.set('beforeId', cursor.beforeId);
    }
    setLoadState('loading');
    void fetch(`/api/admin/invoices/bank-receipts/history?${query}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as HistoryPage;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setPage(result);
          setLoadState('ready');
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          const forbidden = error instanceof Error && ['401', '403'].includes(error.message);
          if (forbidden) setPage({ items: [], nextCursor: null });
          setLoadState(forbidden ? 'forbidden' : 'error');
        }
      });
    return () => controller.abort();
  }, [criteria, cursorKey, revision, retryRevision]);

  function applyInvoice(event: FormEvent) {
    event.preventDefault();
    const value = invoiceInput.trim();
    if (value && !isInvoiceUuid(value)) {
      setInvalidInvoice(true);
      return;
    }
    setInvalidInvoice(false);
    setPage({ items: [], nextCursor: null });
    setLoadState('loading');
    if (value === invoiceId && !cursor) setRetryRevision((value) => value + 1);
    queryBinding.setQuery({ filters: { invoiceId: value }, cursor: '' });
  }

  return (
    <section className="space-y-4 border-t pt-4" aria-label={word('historyTitle')}>
      <h3 className="font-semibold">{word('historyTitle')}</h3>
      <ListPage>
        <ListPage.Toolbar
          filters={
            <div className="flex min-w-0 flex-wrap items-end gap-3">
              <InvoiceReceiptHistoryFilters binding={queryBinding} />
              <label className="flex min-w-0 flex-col gap-1 text-sm">
                {word('historyState')}
                <select
                  value={state}
                  onChange={(event) => {
                    setPage({ items: [], nextCursor: null });
                    setLoadState('loading');
                    queryBinding.setQuery({ filters: { state: event.target.value } });
                  }}
                  className="min-h-10 rounded-md border bg-background px-3"
                >
                  <option value="">{word('historyAll')}</option>
                  <option value="Confirmed">
                    {appText('invoices.activity.state.Confirmed', locale)}
                  </option>
                  <option value="Rejected">
                    {appText('invoices.activity.state.Rejected', locale)}
                  </option>
                </select>
              </label>
              <form onSubmit={applyInvoice} className="flex min-w-0 flex-wrap items-end gap-2">
                <label className="flex min-w-0 flex-col gap-1 text-sm">
                  {word('invoice')}
                  <input
                    value={invoiceInput}
                    onChange={(event) => {
                      setInvoiceInput(event.target.value);
                      setInvalidInvoice(false);
                    }}
                    aria-invalid={invalidInvoice}
                    className="min-h-10 w-72 max-w-full rounded-md border bg-background px-3"
                  />
                </label>
                <Button type="submit" variant="outline">
                  {word('historyApply')}
                </Button>
              </form>
            </div>
          }
          actions={
            <ListViewToggle
              value={view}
              onChange={setView}
              labels={{
                group: appText('historyView.group', locale),
                table: appText('historyView.table', locale),
                card: appText('historyView.card', locale),
              }}
            />
          }
        />
        {invalidInvoice ? <p role="alert">{word('historyInvalidInvoice')}</p> : null}
        <ListPage.Content
          loading={loadState === 'loading'}
          error={loadState === 'error' || loadState === 'forbidden'}
          empty={page.items.length === 0}
          retainContent={page.items.length > 0 && loadState !== 'forbidden'}
          loadingView={<PageLoading label={word('loading')} />}
          errorView={
            loadState === 'forbidden' ? (
              <p role="alert">{word('forbidden')}</p>
            ) : (
              <div className="space-y-2">
                <p role="alert">{word('historyError')}</p>
                <Button variant="outline" onClick={() => setRetryRevision((value) => value + 1)}>
                  {appText('historyPagination.retry', locale)}
                </Button>
              </div>
            )
          }
          emptyView={<p>{word('historyEmpty')}</p>}
        >
          {page.items.length ? (
            <StaffInvoiceReceiptList
              items={page.items}
              view={view}
              caption={word('historyTitle')}
              onOpen={onOpen}
            />
          ) : null}
        </ListPage.Content>
        {loadState !== 'forbidden' && loadState !== 'error' && (
          <ListPage.Pagination
            kind="cursor"
            hasMore={
              !!page.nextCursor && queryBinding.canAdvance(encodeFinanceCursor(page.nextCursor))
            }
            loading={loadState === 'loading'}
            label={word('historyPages')}
            nextLabel={
              query.order === 'asc'
                ? appText('invoices.receipts.newer', locale)
                : word('historyNext')
            }
            onNext={() => {
              if (!page.nextCursor) return;
              queryBinding.next(encodeFinanceCursor(page.nextCursor));
            }}
            previous={{
              enabled: queryBinding.hasPrevious,
              label: word('historyPrevious'),
              onClick: () => {
                queryBinding.previous();
              },
            }}
          />
        )}
      </ListPage>
    </section>
  );
}
