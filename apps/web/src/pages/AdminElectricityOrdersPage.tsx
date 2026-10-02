import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import {
  Button,
  Card,
  CardContent,
  DualStatusDisplay,
  FinancialReviewSummary,
  Input,
  Label,
  ListPage,
  ScrollArea,
  StatusTimeline,
} from '@barghsa/ui';
import { t as appText } from '@barghsa/i18n/app';
import {
  parseElectricityStaffDecisionReview,
  type ElectricityStaffDecisionReview,
} from '@barghsa/shared/finance';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { ElectricityOrderComments } from '../components/SavingOrderComments.js';
import {
  commercialStatusTone,
  financialStatusTone,
  electricityStatusKey,
} from '../lib/electricity-status-tone.js';
import { electricityTimelineKey, electricityTimelineState } from '../lib/electricity-timeline.js';
import { withCsrf } from '../lib/csrf.js';
import { staffOrderId, type StaffOrderListQuery } from '../lib/staff-order-list-query.js';

interface ReviewOrder {
  orderId: string;
  profileId: string;
  contractId: string | null;
  contractState: string | null;
  invoiceId: string;
  invoiceState: string;
  customerName: string;
  commercialStatus: string;
  financialStatus: string;
  nextAction: string;
  submittedAt: string;
  periodStart: string;
  periodEnd: string;
  totalKwh: string;
  pricingSnapshot: Record<string, unknown>;
  settingsSnapshot: Record<string, unknown>;
  fullAddress: string;
  contractSnapshot: Record<string, unknown>;
  versionId: string;
  totalIrR: string;
  paidIrR: string;
  ageHours?: number;
  priority?: string;
  latestCommentAt?: string;
  timeline?: Array<{
    id: string;
    event: string;
    at: string;
    actor: string | null;
    reason: string | null;
    comment: string | null;
  }>;
  revisionReview?: {
    versionNumber: number;
    staffReason: string | null;
    customerResponse: string | null;
    before: ReviewFacts;
    after: ReviewFacts;
  } | null;
}

interface ReviewFacts {
  periodStart: string | null;
  periodEnd: string | null;
  totalKwh: string | null;
  totalIrR: string | null;
  fullAddress: string | null;
  invoiceId: string | null;
  lines: Array<{ systemKey: string; quantityKwh: string }>;
}

type Decision = 'approve' | 'request-changes' | 'reject';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function pricingLines(snapshot: Record<string, unknown>) {
  if (!Array.isArray(snapshot.lines)) return [];
  return snapshot.lines.filter(
    (
      line
    ): line is {
      systemKey: string;
      quantityKwh: string;
      unitPriceIrR: string;
      subtotalIrR?: string;
      discountIrR?: string;
      netIrR: string;
      vatIrR: string;
    } =>
      typeof line === 'object' &&
      line !== null &&
      typeof line.systemKey === 'string' &&
      typeof line.quantityKwh === 'string' &&
      typeof line.unitPriceIrR === 'string' &&
      typeof line.netIrR === 'string' &&
      typeof line.vatIrR === 'string'
  );
}

function contractTemplate(snapshot: Record<string, unknown>) {
  const value = snapshot.template;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const template = value as Record<string, unknown>;
  if (
    typeof template.name !== 'string' ||
    typeof template.versionNumber !== 'number' ||
    !Number.isInteger(template.versionNumber) ||
    typeof template.text !== 'string'
  )
    return null;
  return { name: template.name, versionNumber: template.versionNumber, text: template.text };
}

export default function AdminElectricityOrdersPage({
  queries,
}: { queries?: StaffOrderListQuery } = {}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => t(`admin.electricityOrders.${key}`, locale);
  const statusLabel = (status: string, kind: 'commercial' | 'financial') => {
    const key = `${kind}.${status}`;
    const label = copy(key);
    return label === `admin.electricityOrders.${key}`
      ? appText(electricityStatusKey(status, kind), locale)
      : label;
  };
  const periodText = (start: string, end: string) => {
    const day = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;
    return `${time.format(start, day)} – ${time.format(new Date(new Date(end).getTime() - 1), day)}`;
  };
  const [accepted, setAccepted] = useState<{
    criteria: string;
    cursor: string | null;
    orders: ReviewOrder[];
    nextAfter: string | null;
  } | null>(null);
  const [localAfter, setLocalAfter] = useState<string | null>(null);
  const after = queries ? queries.queue.query.cursor || null : localAfter;
  const setAfter = (value: string | null) =>
    queries ? queries.queue.setQuery({ cursor: value ?? '' }) : setLocalAfter(value);
  const [localSelected, setLocalSelected] = useState<string | null>(
    () => staffOrderId(new URLSearchParams(window.location.search).get('orderId')) || null
  );
  const selectedId = queries ? queries.selected : localSelected;
  const setSelectedId = (id: string | null, replace = false) =>
    queries ? queries.select(id, replace) : setLocalSelected(id);
  const [lookupId, setLookupId] = useState(
    () => new URLSearchParams(window.location.search).get('orderId') ?? ''
  );
  const [lookupInvalid, setLookupInvalid] = useState(false);
  const [localView, setLocalView] = useState<'review' | 'conversations'>('review');
  const queueView = queries?.queue.query.filters.view || localView;
  const orders = accepted?.criteria === queueView ? accepted.orders : [];
  const nextAfter = accepted?.criteria === queueView ? accepted.nextAfter : null;
  const [loadedDetail, setDetail] = useState<ReviewOrder | null>(null);
  const detail = loadedDetail?.orderId === selectedId ? loadedDetail : null;
  const [detailError, setDetailError] = useState(false);
  const [reason, setReason] = useState('');
  const [action, setAction] = useState<TeamAction | null>(null);
  const [decisionReview, setDecisionReview] = useState<ElectricityStaffDecisionReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState(false);
  const reviewRequest = useRef(0);
  const [revision, setRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);

  function refreshQueue() {
    reviewRequest.current += 1;
    setAccepted(null);
    setAfter(null);
    setRevision((value) => value + 1);
  }

  function selectOrder(id: string) {
    reviewRequest.current += 1;
    setSelectedId(id);
    setLookupId(id);
    setLookupInvalid(false);
    setDetailError(false);
    setReason('');
    setReviewError(false);
    setDecisionReview(null);
    setReviewLoading(false);
    if (!queries) {
      const url = new URL(window.location.href);
      url.searchParams.set('orderId', id);
      window.history.replaceState(window.history.state, '', url.toString());
    }
    if (id === selectedId) setDetailRevision((value) => value + 1);
  }

  function lookupOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = lookupId.trim();
    if (!UUID_RE.test(id)) {
      setLookupInvalid(true);
      return;
    }
    selectOrder(id);
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setDenied(false);
    const url = after
      ? `/api/staff/electricity/orders${queueView === 'conversations' ? '/conversations' : ''}?after=${encodeURIComponent(after)}`
      : `/api/staff/electricity/orders${queueView === 'conversations' ? '/conversations' : ''}`;
    void fetch(url, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          if (!controller.signal.aborted) {
            setDenied(true);
            setAccepted(null);
            setSelectedId(null, true);
            reviewRequest.current += 1;
            setDetail(null);
            setDetailError(false);
            setAction(null);
            setDecisionReview(null);
            setReviewLoading(false);
          }
          return null;
        }
        if (!response.ok) throw new Error('Queue unavailable');
        return response.json() as Promise<{ orders: ReviewOrder[]; nextAfter: string | null }>;
      })
      .then((value) => {
        if (!controller.signal.aborted && value) {
          setAccepted((current) => {
            const extending =
              !!after &&
              current?.criteria === queueView &&
              current.nextAfter === after &&
              current.cursor !== after;
            const previous = extending ? current.orders : [];
            const shown = new Set(previous.map((order) => order.orderId));
            return {
              criteria: queueView,
              cursor: after,
              orders: [...previous, ...value.orders.filter((order) => !shown.has(order.orderId))],
              nextAfter: staffOrderId(value.nextAfter) || null,
            };
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [after, revision, queueView, listRevision]);

  useEffect(() => {
    setLookupId(selectedId ?? '');
    setLookupInvalid(false);
    setReason('');
  }, [selectedId, queueView]);

  useEffect(() => {
    reviewRequest.current++;
    setAction(null);
    setDecisionReview(null);
    setReviewLoading(false);
    setReviewError(false);
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError(false);
    void fetch(`/api/staff/electricity/orders/${encodeURIComponent(selectedId)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Detail unavailable');
        return response.json() as Promise<ReviewOrder>;
      })
      .then((value) => {
        if (!controller.signal.aborted) setDetail(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetailError(true);
      });
    return () => controller.abort();
  }, [selectedId, revision, detailRevision]);

  async function choose(decision: Decision) {
    if (!detail || reviewLoading || (decision !== 'approve' && !reason.trim())) return;
    const order = detail;
    const request = ++reviewRequest.current;
    const decisionReason = decision === 'approve' ? '' : reason.trim();
    setReviewLoading(true);
    setReviewError(false);
    try {
      const response = await fetch(
        `/api/staff/electricity/orders/${encodeURIComponent(order.orderId)}/financial-review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ action: decision, reason: decisionReason }),
        }
      );
      if (!response.ok) throw new Error('Review unavailable');
      const review = parseElectricityStaffDecisionReview(await response.json());
      if (request !== reviewRequest.current) return;
      if (
        !review ||
        review.scope.resourceId !== order.orderId ||
        review.scope.profileId !== order.profileId ||
        review.data.versionId !== order.versionId ||
        review.data.reason !== decisionReason
      )
        throw new Error('Review mismatch');
      setDecisionReview(review);
      setAction({
        title: copy(decision),
        description: copy('confirm'),
        path: `/api/staff/electricity/orders/${encodeURIComponent(order.orderId)}/${decision}`,
        method: 'POST',
        body: {
          idempotencyKey: crypto.randomUUID(),
          expectedVersionId: review.data.versionId,
          expectedReviewHash: review.hash,
          ...(decision === 'approve' ? {} : { reason: decisionReason }),
        },
        conflictMessage: copy('conflict'),
        forbiddenMessage: copy('forbidden'),
      });
    } catch {
      if (request === reviewRequest.current) {
        setReviewError(true);
        setDecisionReview(null);
      }
    } finally {
      if (request === reviewRequest.current) setReviewLoading(false);
    }
  }

  const selectedTemplate = detail ? contractTemplate(detail.contractSnapshot) : null;

  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy('title')}</h1>
          <p className="text-muted-foreground">{copy('description')}</p>
        </div>
      </header>
      <ListPage>
        <ListPage.Toolbar
          filters={
            <div className="space-y-3">
              <form className="flex flex-wrap items-end gap-3" onSubmit={lookupOrder}>
                <div className="min-w-0 flex-1 basis-64 space-y-2">
                  <Label htmlFor="electricity-order-lookup">{copy('lookupOrderId')}</Label>
                  <Input
                    id="electricity-order-lookup"
                    dir="ltr"
                    value={lookupId}
                    onChange={(event) => {
                      setLookupId(event.target.value);
                      setLookupInvalid(false);
                    }}
                    aria-invalid={lookupInvalid}
                    aria-describedby={lookupInvalid ? 'electricity-order-lookup-error' : undefined}
                  />
                </div>
                <Button type="submit">{copy('lookup')}</Button>
                {lookupInvalid ? (
                  <p id="electricity-order-lookup-error" role="alert" className="w-full text-sm">
                    {copy('invalidOrderId')}
                  </p>
                ) : null}
              </form>
              <nav className="flex flex-wrap gap-2" aria-label={copy('views')}>
                <Button
                  variant={queueView === 'review' ? 'secondary' : 'outline'}
                  onClick={() => {
                    if (queueView === 'review') return;
                    if (queries) queries.changeLane('review');
                    else {
                      setLocalView('review');
                      setLocalAfter(null);
                      setSelectedId(null);
                    }
                  }}
                >
                  {copy('reviewView')}
                </Button>
                <Button
                  variant={queueView === 'conversations' ? 'secondary' : 'outline'}
                  onClick={() => {
                    if (queueView === 'conversations') return;
                    if (queries) queries.changeLane('conversations');
                    else {
                      setLocalView('conversations');
                      setLocalAfter(null);
                      setSelectedId(null);
                    }
                  }}
                >
                  {copy('conversationView')}
                </Button>
              </nav>
            </div>
          }
          actions={
            <Button variant="outline" onClick={refreshQueue} disabled={loading}>
              {copy('refresh')}
            </Button>
          }
        />
        {time.notice}
        <div className="grid gap-5 xl:grid-cols-[minmax(16rem,1fr)_minmax(24rem,2fr)]">
          <div
            className="space-y-3"
            aria-label={copy(queueView === 'conversations' ? 'conversationView' : 'queue')}
          >
            <ListPage.Content
              loading={loading}
              error={error || denied}
              empty={orders.length === 0 && !selectedId}
              retainContent={orders.length > 0 && !denied}
              loadingView={<p role="status">{copy('loading')}</p>}
              errorView={
                denied ? (
                  <p role="alert">{copy('forbidden')}</p>
                ) : (
                  <div className="space-y-2">
                    <p role="alert">{copy('error')}</p>
                    <Button variant="outline" onClick={() => setListRevision((value) => value + 1)}>
                      {appText('historyPagination.retry', locale)}
                    </Button>
                  </div>
                )
              }
              emptyView={
                <p>{copy(queueView === 'conversations' ? 'emptyConversations' : 'empty')}</p>
              }
            >
              {orders.map((order) => (
                <Button
                  key={order.orderId}
                  variant={selectedId === order.orderId ? 'secondary' : 'outline'}
                  className="h-auto w-full justify-start whitespace-normal p-4 text-start"
                  onClick={() => selectOrder(order.orderId)}
                >
                  <span className="space-y-1">
                    <strong className="block">{order.customerName}</strong>
                    <span className="block text-xs">{order.orderId}</span>
                    <span className="block text-xs">
                      {queueView === 'conversations' && order.latestCommentAt
                        ? time.format(order.latestCommentAt)
                        : `${copy(`priority.${order.priority ?? 'normal'}`)} · ${numbers.number(order.ageHours ?? 0)} ${copy('hours')}`}
                    </span>
                  </span>
                </Button>
              ))}
            </ListPage.Content>
            <ListPage.Pagination
              kind="cursor"
              hasMore={
                !!nextAfter &&
                !error &&
                !denied &&
                (loading || (queries ? queries.queue.canAdvance(nextAfter) : nextAfter !== after))
              }
              loading={loading}
              onNext={() => {
                if (!nextAfter) return;
                if (queries) queries.queue.next(nextAfter);
                else setAfter(nextAfter);
              }}
              previous={{
                enabled: !denied && (queries?.queue.hasPrevious ?? false),
                onClick: () => queries?.queue.previous(),
                label: appText('historyPagination.previous', locale),
              }}
              label={appText('historyPagination.label', locale)}
              nextLabel={copy('more')}
            />
          </div>
          {selectedId && !detail && !detailError ? (
            <p role="status">{copy('loadingDetail')}</p>
          ) : null}
          {detailError ? (
            <div role="alert" className="space-y-2 text-sm">
              <p>{copy('detailError')}</p>
              <Button variant="outline" onClick={() => setDetailRevision((value) => value + 1)}>
                {copy('retryDetail')}
              </Button>
            </div>
          ) : null}
          {detail ? (
            <Card>
              <CardContent className="space-y-5 pt-6">
                <h2 className="text-lg font-semibold">{copy('detail')}</h2>
                <DualStatusDisplay
                  commercialLabel={copy('commercial')}
                  commercialStatus={statusLabel(detail.commercialStatus, 'commercial')}
                  commercialTone={commercialStatusTone(detail.commercialStatus)}
                  financialLabel={copy('financial')}
                  financialStatus={statusLabel(detail.financialStatus, 'financial')}
                  financialTone={financialStatusTone(detail.financialStatus)}
                />
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">{copy('customer')}</dt>
                    <dd>{detail.customerName}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{copy('submitted')}</dt>
                    <dd>{time.format(detail.submittedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{copy('period')}</dt>
                    <dd>{periodText(detail.periodStart, detail.periodEnd)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{copy('quantity')}</dt>
                    <dd>{detail.totalKwh} kWh</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{copy('price')}</dt>
                    <dd>{numbers.money(detail.totalIrR)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{copy('paid')}</dt>
                    <dd>{numbers.money(detail.paidIrR)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{copy('revision.invoice')}</dt>
                    <dd>
                      <a
                        className="text-primary underline underline-offset-2"
                        href={`/admin/invoices?invoiceId=${encodeURIComponent(detail.invoiceId)}`}
                      >
                        {copy('openInvoice')}
                      </a>
                    </dd>
                  </div>
                  {detail.contractId ? (
                    <div>
                      <dt className="text-muted-foreground">{copy('contract')}</dt>
                      <dd>
                        <a
                          className="text-primary underline underline-offset-2"
                          href={`/admin/contracts?contractId=${encodeURIComponent(detail.contractId)}`}
                        >
                          {copy('openContract')}
                        </a>
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <p className="text-sm">
                  <strong>{copy('address')}: </strong>
                  {detail.fullAddress}
                </p>
                <section className="space-y-3">
                  <h3 className="font-medium">{copy('timeline')}</h3>
                  {detail.timeline?.length ? (
                    <StatusTimeline
                      label={copy('timeline')}
                      items={detail.timeline.map((event) => ({
                        id: event.id,
                        title: appText(electricityTimelineKey(event.event), locale),
                        state: electricityTimelineState(event.event),
                        dateTime: event.at,
                        dateLabel: time.format(event.at),
                        description: [event.reason, event.comment].filter(Boolean).join(' · '),
                      }))}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">{copy('emptyTimeline')}</p>
                  )}
                </section>
                <h3 className="font-medium">{copy('products')}</h3>
                <ScrollArea
                  scrollbarOrientation="horizontal"
                  role="region"
                  aria-label={copy('products')}
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start">
                        <th scope="col" className="p-2 text-start">
                          {copy('product')}
                        </th>
                        <th scope="col" className="p-2 text-start">
                          {copy('quantity')}
                        </th>
                        <th scope="col" className="p-2 text-start">
                          {copy('unitPrice')}
                        </th>
                        <th scope="col" className="p-2 text-start">
                          {copy('subtotal')}
                        </th>
                        <th scope="col" className="p-2 text-start">
                          {copy('discount')}
                        </th>
                        <th scope="col" className="p-2 text-start">
                          {copy('lineTotal')}
                        </th>
                        <th scope="col" className="p-2 text-start">
                          {copy('vat')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pricingLines(detail.pricingSnapshot).map((line) => (
                        <tr key={line.systemKey} className="border-b">
                          <td className="p-2">{copy(`product.${line.systemKey}`)}</td>
                          <td className="p-2">{line.quantityKwh} kWh</td>
                          <td className="p-2">{numbers.money(line.unitPriceIrR)}</td>
                          <td className="p-2">
                            {typeof line.subtotalIrR === 'string'
                              ? numbers.money(line.subtotalIrR)
                              : '—'}
                          </td>
                          <td className="p-2">
                            {typeof line.discountIrR === 'string'
                              ? numbers.money(line.discountIrR)
                              : '—'}
                          </td>
                          <td className="p-2">{numbers.money(line.netIrR)}</td>
                          <td className="p-2">{numbers.money(line.vatIrR)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
                {detail.revisionReview ? (
                  <section
                    className="space-y-3 rounded-md border p-4"
                    aria-label={copy('revision.title')}
                  >
                    <h3 className="font-semibold">
                      {copy('revision.title')} #{detail.revisionReview.versionNumber}
                    </h3>
                    {detail.revisionReview.staffReason ? (
                      <p>
                        <strong>{copy('revision.staffReason')}:</strong>{' '}
                        {detail.revisionReview.staffReason}
                      </p>
                    ) : null}
                    {detail.revisionReview.customerResponse ? (
                      <p>
                        <strong>{copy('revision.customerResponse')}:</strong>{' '}
                        {detail.revisionReview.customerResponse}
                      </p>
                    ) : null}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th scope="col" className="p-2 text-start">
                              {copy('revision.field')}
                            </th>
                            <th scope="col" className="p-2 text-start">
                              {copy('revision.previous')}
                            </th>
                            <th scope="col" className="p-2 text-start">
                              {copy('revision.current')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            [
                              ['quantity', 'totalKwh'],
                              ['price', 'totalIrR'],
                              ['address', 'fullAddress'],
                              ['revision.invoice', 'invoiceId'],
                            ] as const
                          ).map(([label, field]) => (
                            <tr key={field} className="border-b">
                              <th scope="row" className="p-2 text-start font-medium">
                                {copy(label)}
                              </th>
                              <td className="p-2">
                                {field === 'totalIrR'
                                  ? detail.revisionReview!.before[field]
                                    ? numbers.money(detail.revisionReview!.before[field]!)
                                    : '—'
                                  : (detail.revisionReview!.before[field] ?? '—')}
                              </td>
                              <td className="p-2">
                                {field === 'totalIrR'
                                  ? detail.revisionReview!.after[field]
                                    ? numbers.money(detail.revisionReview!.after[field]!)
                                    : '—'
                                  : (detail.revisionReview!.after[field] ?? '—')}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-b">
                            <th scope="row" className="p-2 text-start font-medium">
                              {copy('products')}
                            </th>
                            {(
                              [detail.revisionReview.before, detail.revisionReview.after] as const
                            ).map((facts, index) => (
                              <td key={index} className="p-2">
                                {facts.lines.length
                                  ? facts.lines
                                      .map(
                                        (line) =>
                                          `${copy(`product.${line.systemKey}`)}: ${line.quantityKwh} kWh`
                                      )
                                      .join(', ')
                                  : '—'}
                              </td>
                            ))}
                          </tr>
                          <tr className="border-b">
                            <th scope="row" className="p-2 text-start font-medium">
                              {copy('period')}
                            </th>
                            <td className="p-2">
                              {detail.revisionReview.before.periodStart &&
                              detail.revisionReview.before.periodEnd
                                ? periodText(
                                    detail.revisionReview.before.periodStart,
                                    detail.revisionReview.before.periodEnd
                                  )
                                : '—'}
                            </td>
                            <td className="p-2">
                              {detail.revisionReview.after.periodStart &&
                              detail.revisionReview.after.periodEnd
                                ? periodText(
                                    detail.revisionReview.after.periodStart,
                                    detail.revisionReview.after.periodEnd
                                  )
                                : '—'}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}
                <section
                  className="flex flex-col gap-3 rounded-md border p-4"
                  aria-label={copy('contractPreview')}
                >
                  <h3 className="font-semibold">{copy('contractPreview')}</h3>
                  {selectedTemplate ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {selectedTemplate.name} · {copy('templateVersion')}{' '}
                        {selectedTemplate.versionNumber}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-sm" dir="auto">
                        {selectedTemplate.text}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">{copy('noContractTemplate')}</p>
                  )}
                </section>
                <details className="rounded-md border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">{copy('snapshots')}</summary>
                  <h3 className="mt-3 font-semibold">{copy('pricingSnapshot')}</h3>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(detail.pricingSnapshot, null, 2)}
                  </pre>
                  <h3 className="mt-3 font-semibold">{copy('settingsSnapshot')}</h3>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(detail.settingsSnapshot, null, 2)}
                  </pre>
                  <h3 className="mt-3 font-semibold">{copy('contractSnapshot')}</h3>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(detail.contractSnapshot, null, 2)}
                  </pre>
                </details>
                <ElectricityOrderComments
                  key={detail.orderId}
                  orderId={detail.orderId}
                  staff
                  formatTimestamp={time.format}
                />
                {detail.commercialStatus === 'awaiting_staff_review' ? (
                  <div className="space-y-3 border-t pt-4">
                    <div className="space-y-1">
                      <Label htmlFor="electricity-review-reason">{copy('reason')}</Label>
                      <Input
                        id="electricity-review-reason"
                        maxLength={1000}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={reviewLoading} onClick={() => void choose('approve')}>
                        {copy('approve')}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!reason.trim() || reviewLoading}
                        onClick={() => void choose('request-changes')}
                      >
                        {copy('request-changes')}
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={!reason.trim() || reviewLoading}
                        onClick={() => void choose('reject')}
                      >
                        {copy('reject')}
                      </Button>
                    </div>
                    {reviewLoading ? <p role="status">{copy('reviewLoading')}</p> : null}
                    {reviewError ? <p role="alert">{copy('reviewError')}</p> : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </ListPage>
      {action && decisionReview ? (
        <TeamActionDialog
          action={action}
          summary={
            <FinancialReviewSummary
              title={copy('reviewTitle')}
              rows={[
                {
                  id: 'customer',
                  label: copy('customer'),
                  value: decisionReview.data.customerName,
                },
                {
                  id: 'period',
                  label: copy('period'),
                  value: periodText(decisionReview.data.periodStart, decisionReview.data.periodEnd),
                },
                {
                  id: 'quantity',
                  label: copy('quantity'),
                  value: `${decisionReview.data.totalKwh} kWh`,
                },
                {
                  id: 'contract',
                  label: copy('reviewContractVersion'),
                  value: numbers.number(decisionReview.data.versionNumber),
                },
                {
                  id: 'invoice',
                  label: copy('reviewInvoiceState'),
                  value: appText(`invoices.state.${decisionReview.data.invoiceState}`, locale),
                },
                {
                  id: 'paid',
                  label: copy('paid'),
                  value: numbers.money(decisionReview.data.paidAmount),
                },
                {
                  id: 'outcome',
                  label: copy('reviewOutcome'),
                  value: copy(`reviewOutcome.${decisionReview.data.outcome}`),
                },
                ...pricingLines(decisionReview.data.pricingSnapshot).map((line, index) => ({
                  id: `product-${index}`,
                  label: `${copy(`product.${line.systemKey}`)} · ${line.quantityKwh} kWh`,
                  value: (
                    <span className="space-y-1 text-sm">
                      <span className="block">
                        {copy('unitPrice')}: {numbers.money(line.unitPriceIrR)}
                      </span>
                      {line.discountIrR ? (
                        <span className="block">
                          {copy('discount')}: {numbers.money(line.discountIrR)}
                        </span>
                      ) : null}
                      <span className="block">
                        {copy('vat')}: {numbers.money(line.vatIrR)}
                      </span>
                      <span className="block">
                        {copy('lineTotal')}: {numbers.money(line.netIrR)}
                      </span>
                    </span>
                  ),
                })),
                ...(decisionReview.data.refundAmount !== '0'
                  ? [
                      {
                        id: 'refund',
                        label: copy('reviewRefund'),
                        value: numbers.money(decisionReview.data.refundAmount),
                      },
                    ]
                  : []),
                ...(decisionReview.data.releasesGiftCode
                  ? [
                      {
                        id: 'gift-code',
                        label: copy('reviewGiftCode'),
                        value: copy('reviewGiftCodeRelease'),
                      },
                    ]
                  : []),
              ]}
              total={{
                label: copy('price'),
                value: numbers.money(decisionReview.data.invoiceTotal),
              }}
              notice={
                <div className="space-y-2">
                  <p>{decisionReview.data.reason || copy('reviewNotice')}</p>
                  {contractTemplate(decisionReview.data.contractSnapshot)?.text ? (
                    <p className="whitespace-pre-wrap break-words" dir="auto">
                      {contractTemplate(decisionReview.data.contractSnapshot)!.text}
                    </p>
                  ) : null}
                </div>
              }
            />
          }
          onClose={() => {
            setAction(null);
            setDecisionReview(null);
          }}
          onSuccess={async () => {
            setReason('');
            refreshQueue();
          }}
        />
      ) : null}
    </section>
  );
}
