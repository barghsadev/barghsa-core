import { useEffect, useId, useState, type FormEvent } from 'react';
import { Button } from '@barghsa/ui';
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
import { isInvoiceUuid } from '../lib/due-at-override.js';
import { useAccountTime } from '../hooks/useAccountTime.js';

const types = ['topup', 'payment', 'refund', 'reservation', 'release', 'reversal', 'compensating'];
const states = ['Pending', 'Reserved', 'Completed', 'Failed', 'Rejected', 'Released', 'Reversed'];
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

/** A profile change unmounts the old request and its results. */
export function WalletTransactionList({
  profileId,
  locale,
}: {
  profileId: string;
  locale: Locale;
}) {
  return <History key={profileId} profileId={profileId} locale={locale} />;
}
function History({ profileId, locale }: { profileId: string; locale: Locale }) {
  const id = useId();
  const time = useAccountTime(locale);
  const [filters, setFilters] = useState('sort=desc');
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of ['type', 'state', 'sort']) {
      const value = String(form.get(key) ?? '');
      if (value) params.set(key, value);
    }
    const from = String(form.get('from') ?? '');
    const to = String(form.get('to') ?? '');
    if (from) params.set('from', `${from}T00:00:00Z`);
    if (to) params.set('to', `${to}T23:59:59.999999Z`);
    setFilters(params.toString());
  }
  const label = (key: string) => t(`wallet.history.${key}`, locale);
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
      <form onSubmit={apply} className="flex flex-wrap items-end gap-3">
        {(['type', 'state'] as const).map((key) => (
          <label key={key} className="flex flex-col gap-1 text-sm">
            {label(key)}
            <select name={key} className="rounded-md border border-input bg-background p-2">
              <option value="">{label('all')}</option>
              {(key === 'type' ? types : states).map((value) => (
                <option key={value} value={value}>
                  {label(`${key}.${value}`)}
                </option>
              ))}
            </select>
          </label>
        ))}
        {['from', 'to'].map((key) => (
          <label key={key} className="flex flex-col gap-1 text-sm">
            {label(key)}
            <input
              type="date"
              name={key}
              className="rounded-md border border-input bg-background p-2"
            />
          </label>
        ))}
        <label className="flex flex-col gap-1 text-sm">
          {label('sort')}
          <select
            name="sort"
            defaultValue="desc"
            className="rounded-md border border-input bg-background p-2"
          >
            <option value="desc">{label('newest')}</option>
            <option value="asc">{label('oldest')}</option>
          </select>
        </label>
        <Button type="submit" variant="outline">
          {label('apply')}
        </Button>
      </form>
      <HistoryPage
        key={filters}
        profileId={profileId}
        locale={locale}
        filters={filters}
        formatTime={time.format}
      />
    </section>
  );
}
function HistoryPage({
  profileId,
  locale,
  filters,
  formatTime,
}: {
  profileId: string;
  locale: Locale;
  filters: string;
  formatTime: ReturnType<typeof useAccountTime>['format'];
}) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const cursor = cursors.at(-1);
  const label = (key: string) => t(`wallet.history.${key}`, locale);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setError(false);
    const params = new URLSearchParams(filters);
    params.set('limit', '25');
    if (cursor) params.set('cursor', cursor);
    void fetch(`/api/wallet/${encodeURIComponent(profileId)}/transactions?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('History unavailable');
        const data = (await response.json()) as Page;
        if (
          !Array.isArray(data.transactions) ||
          !(data.nextCursor === null || typeof data.nextCursor === 'string')
        )
          throw new Error('Invalid history');
        if (!controller.signal.aborted) setPage(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [profileId, filters, cursor, attempt]);
  if (error)
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{label('error')}</p>
        <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          {label('retry')}
        </Button>
      </div>
    );
  if (!page) return <p role="status">{label('loading')}</p>;
  return (
    <div className="flex flex-col gap-4">
      {page.transactions.length === 0 ? (
        <p>{label('empty')}</p>
      ) : (
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
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={cursors.length === 1}
          onClick={() => {
            setPage(null);
            setCursors((values) => values.slice(0, -1));
          }}
        >
          {label('previous')}
        </Button>
        <Button
          variant="outline"
          disabled={!page.nextCursor}
          onClick={() => {
            setPage(null);
            setCursors((values) => [...values, page.nextCursor]);
          }}
        >
          {label('next')}
        </Button>
      </div>
    </div>
  );
}
