import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, ListPage, PageLoading, StatusBadge } from '@barghsa/ui';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';

import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { decodeFinanceCursor, encodeFinanceCursor } from '../lib/finance-list-query.js';

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
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const word = (key: string) => adminText(`admin.invoiceReceipts.${key}`, locale);
  const [localState, setLocalState] = useState<'' | 'Confirmed' | 'Rejected'>('');
  const state = binding?.query.filters.state ?? localState;
  const [invoiceInput, setInvoiceInput] = useState('');
  const [localInvoiceId, setLocalInvoiceId] = useState('');
  const invoiceId = binding?.query.filters.invoiceId ?? localInvoiceId;
  const [invalidInvoice, setInvalidInvoice] = useState(false);
  const [localCursor, setLocalCursor] = useState<Cursor | null>(null);
  const cursor = useMemo(
    () => (binding ? decodeFinanceCursor(binding.query.cursor) : localCursor),
    [binding?.query.cursor, localCursor]
  );
  const cursorKey = encodeFinanceCursor(cursor);
  const [previous, setPrevious] = useState<Array<Cursor | null>>([]);
  const [retryRevision, setRetryRevision] = useState(0);
  const criteria = JSON.stringify([state, invoiceId]);
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
    if (!binding) return;
    setInvoiceInput(invoiceId);
    setInvalidInvoice(false);
  }, [invoiceId, !!binding]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (state) query.set('state', state);
    if (invoiceId) query.set('invoiceId', invoiceId);
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
  }, [state, invoiceId, cursorKey, revision, retryRevision]);

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
    setLocalCursor(null);
    setPrevious([]);
    if (binding) binding.setQuery({ filters: { invoiceId: value }, cursor: '' });
    else setLocalInvoiceId(value);
  }

  return (
    <section className="space-y-4 border-t pt-4" aria-label={word('historyTitle')}>
      <h3 className="font-semibold">{word('historyTitle')}</h3>
      <ListPage>
        <ListPage.Toolbar
          filters={
            <div className="flex min-w-0 flex-wrap items-end gap-3">
              <label className="flex min-w-0 flex-col gap-1 text-sm">
                {word('historyState')}
                <select
                  value={state}
                  onChange={(event) => {
                    setPage({ items: [], nextCursor: null });
                    setLoadState('loading');
                    if (binding) binding.setQuery({ filters: { state: event.target.value } });
                    else setLocalState(event.target.value as typeof localState);
                    setLocalCursor(null);
                    setPrevious([]);
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
            <ul className="divide-y rounded-lg border">
              {page.items.map((item) => (
                <li
                  key={item.receiptId}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <div className="space-y-1 text-sm">
                    <p>
                      <bdi className="break-all">{item.receiptId}</bdi>
                    </p>
                    <p>
                      {word('invoice')}: <bdi className="break-all">{item.invoiceId}</bdi>
                    </p>
                    <p>
                      {numbers.money(item.amount)} · {time.format(item.submittedAt)}
                    </p>
                    <p className="break-words">
                      {word('bankName')}: {item.bankName ?? '—'}
                    </p>
                    <p>
                      {word('paymentDate')}: <bdi>{item.paymentDate}</bdi>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge label={appText(`invoices.activity.state.${item.state}`, locale)} />
                    <Button variant="outline" onClick={() => onOpen(item.receiptId)}>
                      {word('open')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </ListPage.Content>
        {loadState !== 'forbidden' && loadState !== 'error' && (
          <ListPage.Pagination
            kind="cursor"
            hasMore={
              !!page.nextCursor &&
              (!binding || binding.canAdvance(encodeFinanceCursor(page.nextCursor)))
            }
            loading={loadState === 'loading'}
            label={word('historyPages')}
            nextLabel={word('historyNext')}
            onNext={() => {
              if (!page.nextCursor) return;
              if (binding) binding.next(encodeFinanceCursor(page.nextCursor));
              else {
                setPrevious((items) => [...items, cursor]);
                setLocalCursor(page.nextCursor);
              }
            }}
            previous={{
              enabled: binding ? binding.hasPrevious : previous.length > 0,
              label: word('historyPrevious'),
              onClick: () => {
                if (binding) binding.previous();
                else {
                  setLocalCursor(previous.at(-1) ?? null);
                  setPrevious((items) => items.slice(0, -1));
                }
              },
            }}
          />
        )}
      </ListPage>
    </section>
  );
}
