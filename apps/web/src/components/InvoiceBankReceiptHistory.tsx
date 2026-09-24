import { useEffect, useState, type FormEvent } from 'react';
import { Button, PageLoading, StatusBadge } from '@barghsa/ui';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';

interface HistoryItem {
  receiptId: string;
  invoiceId: string;
  amount: string;
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
}: {
  onOpen: (receiptId: string) => void;
  revision: number;
}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const word = (key: string) => adminText(`admin.invoiceReceipts.${key}`, locale);
  const [state, setState] = useState<'' | 'Confirmed' | 'Rejected'>('');
  const [invoiceInput, setInvoiceInput] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [invalidInvoice, setInvalidInvoice] = useState(false);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [previous, setPrevious] = useState<Array<Cursor | null>>([]);
  const [page, setPage] = useState<HistoryPage>({ items: [], nextCursor: null });
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>(
    'loading'
  );

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
        if (!controller.signal.aborted)
          setLoadState(error instanceof Error && error.message === '403' ? 'forbidden' : 'error');
      });
    return () => controller.abort();
  }, [state, invoiceId, cursor, revision]);

  function applyInvoice(event: FormEvent) {
    event.preventDefault();
    const value = invoiceInput.trim();
    if (value && !isInvoiceUuid(value)) {
      setInvalidInvoice(true);
      return;
    }
    setInvalidInvoice(false);
    setCursor(null);
    setPrevious([]);
    setInvoiceId(value);
  }

  return (
    <section className="space-y-4 border-t pt-4" aria-label={word('historyTitle')}>
      <h3 className="font-semibold">{word('historyTitle')}</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {word('historyState')}
          <select
            value={state}
            onChange={(event) => {
              setState(event.target.value as typeof state);
              setCursor(null);
              setPrevious([]);
            }}
            className="min-h-10 rounded-md border bg-background px-3"
          >
            <option value="">{word('historyAll')}</option>
            <option value="Confirmed">
              {appText('invoices.activity.state.Confirmed', locale)}
            </option>
            <option value="Rejected">{appText('invoices.activity.state.Rejected', locale)}</option>
          </select>
        </label>
        <form onSubmit={applyInvoice} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
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
      {invalidInvoice ? <p role="alert">{word('historyInvalidInvoice')}</p> : null}
      {loadState === 'loading' ? <PageLoading label={word('loading')} /> : null}
      {loadState === 'error' ? <p role="alert">{word('historyError')}</p> : null}
      {loadState === 'forbidden' ? <p role="alert">{word('forbidden')}</p> : null}
      {loadState === 'ready' && !page.items.length ? <p>{word('historyEmpty')}</p> : null}
      {loadState === 'ready' && page.items.length ? (
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
      {loadState === 'ready' && (previous.length > 0 || page.nextCursor) ? (
        <nav aria-label={word('historyPages')} className="flex gap-2">
          <Button
            variant="outline"
            disabled={!previous.length}
            onClick={() => {
              setCursor(previous.at(-1) ?? null);
              setPrevious((items) => items.slice(0, -1));
            }}
          >
            {word('historyPrevious')}
          </Button>
          <Button
            variant="outline"
            disabled={!page.nextCursor}
            onClick={() => {
              if (!page.nextCursor) return;
              setPrevious((items) => [...items, cursor]);
              setCursor(page.nextCursor);
            }}
          >
            {word('historyNext')}
          </Button>
        </nav>
      ) : null}
    </section>
  );
}
