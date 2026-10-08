import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ListPage, ScrollArea } from '@barghsa/ui';
import type { FormEvent } from 'react';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { t as appText } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { decodeFinanceCursor, encodeFinanceCursor } from '../lib/finance-list-query.js';
import { formatInvoiceServicePeriod } from '../lib/invoice-service-period.js';

interface InvoiceRow {
  invoiceId: string;
  profileId: string;
  orderId: string | null;
  type: string | null;
  state: string;
  totalAmount: string;
  paidAmount: string;
  refundedAmount: string;
  issuedAt: string | null;
  dueAt: string | null;
  periodStart?: string;
  periodEnd?: string;
  createdAt: string;
}

interface InvoiceDetail extends InvoiceRow {
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    vatRate: number;
    vatAmount: string;
  }>;
  activity: {
    payments: Array<{
      id: string;
      source: string;
      amount: string;
      state: string;
      createdAt: string;
    }>;
    bankReceipts: Array<{
      id: string;
      amount: string;
      state: string;
      paymentDate: string;
      bankName: string | null;
      payerReference: string;
      createdAt: string;
    }>;
    refunds: Array<{ id: string; amount: string; state: string; createdAt: string }>;
  };
}

interface Page {
  items: InvoiceRow[];
  nextCursor: { beforeAt: string; beforeId: string } | null;
}

const states = [
  'Draft',
  'Unpaid',
  'PaymentUnderReview',
  'PartiallyFunded',
  'Paid',
  'Overdue',
  'Cancelled',
  'PartiallyRefunded',
  'Refunded',
];
const base = '/api/admin/invoices/ledger';

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { credentials: 'include', signal });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

export function InvoiceLedger({
  onSelectForDueAt,
  onSelectForRefund,
  onOpenReceipt,
  initialInvoiceId = '',
  query,
}: {
  onSelectForDueAt: (invoiceId: string) => void;
  onSelectForRefund?: (invoiceId: string) => void;
  onOpenReceipt: (receiptId: string, state: string) => void;
  initialInvoiceId?: string;
  query?: ListQueryBinding;
}) {
  const deepLinkId =
    query?.query.filters.invoiceId ?? (isInvoiceUuid(initialInvoiceId) ? initialInvoiceId : '');
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const word = (key: string) => t(`admin.invoices.ledger.${key}`, locale);
  const invoiceType = (value: string | null) =>
    value === 'manual' || value === 'auto' ? word(`type.${value}`) : (value ?? word('unknown'));
  const activityState = (value: string) => appText(`invoices.activity.state.${value}`, locale);
  const [localState, setLocalState] = useState('');
  const state = query?.query.filters.state ?? localState;
  const [idInput, setIdInput] = useState(deepLinkId);
  const [localInvoiceId, setLocalInvoiceId] = useState(deepLinkId);
  const invoiceId = query?.query.filters.invoiceId ?? localInvoiceId;
  const [profileInput, setProfileInput] = useState('');
  const [localProfileId, setLocalProfileId] = useState('');
  const profileId = query?.query.filters.profileId ?? localProfileId;
  const [orderInput, setOrderInput] = useState('');
  const [localOrderId, setLocalOrderId] = useState('');
  const orderId = query?.query.filters.orderId ?? localOrderId;
  const [localCursor, setLocalCursor] = useState<Page['nextCursor']>(null);
  const cursor = useMemo(
    () => (query ? decodeFinanceCursor(query.query.cursor) : localCursor),
    [query?.query.cursor, localCursor]
  );
  const cursorKey = encodeFinanceCursor(cursor);
  const criteria = JSON.stringify([state, invoiceId, profileId, orderId]);
  const [accepted, setAccepted] = useState({ criteria, cursor: cursorKey, pages: [] as Page[] });
  const pages = accepted.criteria === criteria ? accepted.pages : [];
  const setPages = (pages: Page[]) => setAccepted({ criteria, cursor: cursorKey, pages });
  const previousCriteria = useRef(criteria);
  const [status, setStatus] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [inputError, setInputError] = useState<
    'invalidId' | 'invalidProfileId' | 'invalidOrderId' | null
  >(null);
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkId || null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [detailStatus, setDetailStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);

  useEffect(() => {
    if (!query) return;
    setIdInput(invoiceId);
    setProfileInput(profileId);
    setOrderInput(orderId);
    setInputError(null);
  }, [invoiceId, profileId, orderId, !!query]);
  useEffect(() => {
    if (previousCriteria.current === criteria) return;
    previousCriteria.current = criteria;
    setSelectedId(null);
    setDetail(null);
  }, [criteria]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (state) params.set('state', state);
    if (invoiceId) params.set('invoiceId', invoiceId);
    if (profileId) params.set('profileId', profileId);
    if (orderId) params.set('orderId', orderId);
    if (cursor) {
      params.set('beforeAt', cursor.beforeAt);
      params.set('beforeId', cursor.beforeId);
    }
    setStatus('loading');
    void getJson<Page>(`${base}${params.size ? `?${params}` : ''}`, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setAccepted((current) => {
          const sameCriteria = current.criteria === criteria;
          const extending =
            !!cursorKey &&
            sameCriteria &&
            cursorKey !== current.cursor &&
            cursorKey === encodeFinanceCursor(current.pages.at(-1)?.nextCursor);
          const refreshing =
            sameCriteria && cursorKey === current.cursor && current.pages.length > 0;
          return {
            criteria,
            cursor: cursorKey,
            pages: extending
              ? [...current.pages, page]
              : refreshing
                ? [...current.pages.slice(0, -1), page]
                : [page],
          };
        });
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          if (error instanceof Error && ['401', '403'].includes(error.message)) {
            setPages([]);
            setSelectedId(null);
            setDetail(null);
            setStatus('forbidden');
          } else setStatus('error');
        }
      });
    return () => controller.abort();
  }, [state, invoiceId, profileId, orderId, cursorKey, criteria, revision]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setDetail(null);
    setDetailStatus('loading');
    void getJson<InvoiceDetail>(`${base}/${encodeURIComponent(selectedId)}`, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setDetail(value);
          setDetailStatus('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetailStatus('error');
      });
    return () => controller.abort();
  }, [selectedId, detailRevision]);

  function lookup(event: FormEvent) {
    event.preventDefault();
    const id = idInput.trim();
    const profile = profileInput.trim();
    const order = orderInput.trim();
    const invalid = (
      [
        [id, 'invalidId'],
        [profile, 'invalidProfileId'],
        [order, 'invalidOrderId'],
      ] as const
    ).find(([value]) => value && !isInvoiceUuid(value));
    if (invalid) return setInputError(invalid[1]);
    setInputError(null);
    setPages([]);
    setLocalCursor(null);
    setSelectedId(null);
    setDetail(null);
    if (query)
      query.setQuery({
        filters: { invoiceId: id, profileId: profile, orderId: order },
        cursor: '',
      });
    else {
      setLocalInvoiceId(id);
      setLocalProfileId(profile);
      setLocalOrderId(order);
    }
    if (id === invoiceId && profile === profileId && order === orderId && !cursor)
      setRevision((value) => value + 1);
  }

  const current = pages.at(-1);
  const items = pages.flatMap((page) => page.items);
  const vat = detail?.lines.reduce((sum, line) => sum + BigInt(line.vatAmount), 0n) ?? 0n;

  return (
    <section
      className="space-y-5 rounded-xl border border-border bg-card p-5"
      aria-labelledby="invoice-ledger-title"
    >
      <div>
        <h2 id="invoice-ledger-title" className="text-xl font-semibold text-foreground">
          {word('title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{word('description')}</p>
      </div>
      <ListPage>
        <ListPage.Toolbar
          filters={
            <div className="flex min-w-0 flex-wrap items-end gap-3">
              <label className="grid min-w-40 gap-1 text-sm">
                <span>{word('state')}</span>
                <select
                  className="rounded-md border border-input bg-background px-3 py-2"
                  value={state}
                  onChange={(event) => {
                    setPages([]);
                    setLocalCursor(null);
                    setSelectedId(null);
                    setDetail(null);
                    if (query) query.setQuery({ filters: { state: event.target.value } });
                    else setLocalState(event.target.value);
                  }}
                >
                  <option value="">{word('allStates')}</option>
                  {states.map((value) => (
                    <option key={value} value={value}>
                      {appText(`invoices.state.${value}`, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <form
                onSubmit={lookup}
                className="flex min-w-0 flex-1 basis-full flex-wrap items-end gap-2 sm:basis-60"
              >
                <label className="grid min-w-0 flex-1 basis-60 gap-1 text-sm">
                  <span>{word('searchId')}</span>
                  <input
                    className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                    dir="ltr"
                    value={idInput}
                    onChange={(event) => setIdInput(event.target.value)}
                    aria-invalid={inputError === 'invalidId'}
                  />
                </label>
                <label className="grid min-w-0 flex-1 basis-60 gap-1 text-sm">
                  <span>{word('searchProfileId')}</span>
                  <input
                    className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                    dir="ltr"
                    value={profileInput}
                    onChange={(event) => setProfileInput(event.target.value)}
                    aria-invalid={inputError === 'invalidProfileId'}
                  />
                </label>
                <label className="grid min-w-0 flex-1 basis-60 gap-1 text-sm">
                  <span>{word('searchOrderId')}</span>
                  <input
                    className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                    dir="ltr"
                    value={orderInput}
                    onChange={(event) => setOrderInput(event.target.value)}
                    aria-invalid={inputError === 'invalidOrderId'}
                  />
                </label>
                <button
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  type="submit"
                >
                  {word('search')}
                </button>
              </form>
            </div>
          }
        />
        {inputError ? (
          <p role="alert" className="text-sm text-destructive">
            {word(inputError)}
          </p>
        ) : null}
        <ListPage.Content
          loading={status === 'loading'}
          error={status === 'error' || status === 'forbidden'}
          empty={items.length === 0}
          retainContent={items.length > 0 && status !== 'forbidden'}
          loadingView={<p role="status">{word('loading')}</p>}
          errorView={
            status === 'forbidden' ? (
              <p role="alert">{word('forbidden')}</p>
            ) : (
              <div className="space-y-2">
                <p role="alert">{word('error')}</p>
                <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
                  {word('retry')}
                </Button>
              </div>
            )
          }
          emptyView={
            <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              {word('empty')}
            </p>
          }
        >
          {items.length ? (
            <ScrollArea
              scrollbarOrientation="horizontal"
              role="group"
              aria-label={word('title')}
              className="min-w-0 max-w-full"
            >
              <table className="w-full min-w-[700px] text-start text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="p-2 text-start">{word('invoice')}</th>
                    <th className="p-2 text-start">{word('type')}</th>
                    <th className="p-2 text-start">{word('state')}</th>
                    <th className="p-2 text-start">{word('amount')}</th>
                    <th className="p-2 text-start">{word('paid')}</th>
                    <th className="p-2 text-start">{word('due')}</th>
                    <th className="p-2 text-start">{word('period')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.invoiceId} className="border-b last:border-0">
                      <td className="p-2">
                        <button
                          type="button"
                          className="font-mono text-primary underline underline-offset-2"
                          dir="ltr"
                          aria-label={`${word('detail')}: ${item.invoiceId}`}
                          onClick={() => setSelectedId(item.invoiceId)}
                        >
                          {item.invoiceId.slice(0, 8)}…
                        </button>
                      </td>
                      <td className="p-2">{invoiceType(item.type)}</td>
                      <td className="p-2">{appText(`invoices.state.${item.state}`, locale)}</td>
                      <td className="p-2 whitespace-nowrap">{numbers.money(item.totalAmount)}</td>
                      <td className="p-2 whitespace-nowrap">{numbers.money(item.paidAmount)}</td>
                      <td className="p-2 whitespace-nowrap">{time.format(item.dueAt)}</td>
                      <td className="p-2 whitespace-nowrap">
                        {item.periodStart && item.periodEnd
                          ? formatInvoiceServicePeriod(
                              item.periodStart,
                              item.periodEnd,
                              time.format
                            )
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          ) : null}
        </ListPage.Content>
        <ListPage.Pagination
          kind="cursor"
          hasMore={
            !!current?.nextCursor &&
            (status === 'loading' ||
              (status === 'ready' &&
                (!query || query.canAdvance(encodeFinanceCursor(current.nextCursor)))))
          }
          loading={status === 'loading'}
          onNext={() => {
            if (current?.nextCursor) {
              if (query) query.next(encodeFinanceCursor(current.nextCursor));
              else setLocalCursor(current.nextCursor);
            }
          }}
          label={appText('historyPagination.label', locale)}
          nextLabel={word('more')}
          {...(query
            ? {
                previous: {
                  enabled: status !== 'error' && status !== 'forbidden' && query.hasPrevious,
                  label: word('previous'),
                  onClick: query.previous,
                },
              }
            : {})}
        />
      </ListPage>

      {selectedId ? (
        <section
          className="space-y-4 rounded-lg border border-border bg-background p-5"
          aria-labelledby="invoice-ledger-detail-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="invoice-ledger-detail-title" className="text-lg font-semibold">
              {word('detail')}
            </h3>
            <button
              type="button"
              className="text-sm text-primary underline"
              onClick={() => setSelectedId(null)}
            >
              {word('close')}
            </button>
          </div>
          {detailStatus === 'loading' ? <p role="status">{word('loadingDetail')}</p> : null}
          {detailStatus === 'error' ? (
            <p role="alert">
              {word('detailError')}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => setDetailRevision((value) => value + 1)}
              >
                {word('retry')}
              </button>
            </p>
          ) : null}
          {detail ? (
            <>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{word('invoice')}</dt>
                  <dd className="break-all font-mono" dir="ltr">
                    {detail.invoiceId}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('profile')}</dt>
                  <dd className="break-all font-mono" dir="ltr">
                    {detail.profileId}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('state')}</dt>
                  <dd>{appText(`invoices.state.${detail.state}`, locale)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('type')}</dt>
                  <dd>{invoiceType(detail.type)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('amount')}</dt>
                  <dd className="font-semibold">{numbers.money(detail.totalAmount)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('paid')}</dt>
                  <dd>{numbers.money(detail.paidAmount)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('refunded')}</dt>
                  <dd>{numbers.money(detail.refundedAmount)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('issued')}</dt>
                  <dd>{time.format(detail.issuedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('due')}</dt>
                  <dd>{time.format(detail.dueAt)}</dd>
                </div>
                {detail.periodStart && detail.periodEnd ? (
                  <div>
                    <dt className="text-muted-foreground">{word('period')}</dt>
                    <dd>
                      {formatInvoiceServicePeriod(
                        detail.periodStart,
                        detail.periodEnd,
                        time.format
                      )}
                    </dd>
                  </div>
                ) : null}
                {detail.orderId ? (
                  <div>
                    <dt className="text-muted-foreground">{word('order')}</dt>
                    <dd className="break-all font-mono" dir="ltr">
                      {detail.orderId}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <button
                type="button"
                className="rounded-md border border-primary px-3 py-2 text-sm text-primary"
                onClick={() => onSelectForDueAt(detail.invoiceId)}
              >
                {word('useDueAt')}
              </button>
              {onSelectForRefund && (
                <button
                  type="button"
                  className="ms-2 rounded-md border border-primary px-3 py-2 text-sm text-primary"
                  onClick={() => onSelectForRefund(detail.invoiceId)}
                >
                  {word('useRefund')}
                </button>
              )}
              <div className="space-y-2">
                <h4 className="mb-2 font-semibold">{word('lines')}</h4>
                <ScrollArea
                  scrollbarOrientation="horizontal"
                  role="region"
                  aria-label={word('lines')}
                  className="min-w-0 max-w-full"
                >
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="p-2 text-start">{word('descriptionColumn')}</th>
                        <th className="p-2 text-start">{word('quantity')}</th>
                        <th className="p-2 text-start">{word('unitPrice')}</th>
                        <th className="p-2 text-start">{word('lineTotal')}</th>
                        <th className="p-2 text-start">{word('vat')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((line, index) => (
                        <tr key={index} className="border-b">
                          <td className="p-2">{line.description}</td>
                          <td className="p-2">{numbers.number(line.quantity)}</td>
                          <td className="p-2">{numbers.money(line.unitPrice)}</td>
                          <td className="p-2">{numbers.money(line.lineTotal)}</td>
                          <td className="p-2">{numbers.money(line.vatAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
                <p className="mt-2 text-sm font-medium">
                  {word('vatTotal')}: {numbers.money(vat)}
                </p>
              </div>
              <div className="space-y-3 text-sm">
                <h4 className="font-semibold">{word('activity')}</h4>
                {detail.activity.payments.map((payment) => (
                  <p key={payment.id} className="rounded-md border p-3">
                    {word('payment')} · {appText(`invoices.activity.${payment.source}`, locale)} ·{' '}
                    {numbers.money(payment.amount)} · {activityState(payment.state)} ·{' '}
                    {time.format(payment.createdAt)}
                  </p>
                ))}
                {detail.activity.bankReceipts.map((receipt) => (
                  <p key={receipt.id} className="rounded-md border p-3">
                    {word('receipt')} · {receipt.bankName ?? word('unknown')} ·{' '}
                    {numbers.money(receipt.amount)} · {activityState(receipt.state)} ·{' '}
                    <bdi>{receipt.paymentDate}</bdi>
                    <br />
                    <bdi className="font-mono">{receipt.payerReference}</bdi>
                    <br />
                    <button
                      type="button"
                      className="text-primary underline underline-offset-2"
                      onClick={() => onOpenReceipt(receipt.id, receipt.state)}
                    >
                      {word('openReceipt')}
                    </button>
                  </p>
                ))}
                {detail.activity.refunds.map((refund) => (
                  <p key={refund.id} className="rounded-md border p-3">
                    {word('refund')} · {numbers.money(refund.amount)} ·{' '}
                    {activityState(refund.state)} · {time.format(refund.createdAt)}
                  </p>
                ))}
                {!detail.activity.payments.length &&
                !detail.activity.bankReceipts.length &&
                !detail.activity.refunds.length ? (
                  <p className="text-muted-foreground">{word('noActivity')}</p>
                ) : null}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
