import { useEffect, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Card, CardContent, DualStatusDisplay, Input, Label, Timeline } from '@barghsa/ui';
import { t as appText } from '@barghsa/i18n/app';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { ElectricityOrderComments } from '../components/SavingOrderComments.js';
import { commercialStatusTone, financialStatusTone } from '../lib/electricity-status-tone.js';
import { electricityTimelineKeys } from '../lib/electricity-timeline.js';

interface ReviewOrder {
  orderId: string;
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

export default function AdminElectricityOrdersPage() {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => t(`admin.electricityOrders.${key}`, locale);
  const periodText = (start: string, end: string) => {
    const day = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;
    return `${time.format(start, day)} – ${time.format(new Date(new Date(end).getTime() - 1), day)}`;
  };
  const [orders, setOrders] = useState<ReviewOrder[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('orderId')
  );
  const [lookupId, setLookupId] = useState(
    () => new URLSearchParams(window.location.search).get('orderId') ?? ''
  );
  const [lookupInvalid, setLookupInvalid] = useState(false);
  const [queueView, setQueueView] = useState<'review' | 'conversations'>('review');
  const [detail, setDetail] = useState<ReviewOrder | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [reason, setReason] = useState('');
  const [action, setAction] = useState<TeamAction | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);

  function refreshQueue() {
    setOrders([]);
    setAfter(null);
    setNextAfter(null);
    setRevision((value) => value + 1);
  }

  function selectOrder(id: string) {
    setSelectedId(id);
    setLookupId(id);
    setLookupInvalid(false);
    setDetailError(false);
    setReason('');
    const url = new URL(window.location.href);
    url.searchParams.set('orderId', id);
    window.history.replaceState(window.history.state, '', url.toString());
    if (id === selectedId) setRevision((value) => value + 1);
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
        if (response.status === 403) {
          if (!controller.signal.aborted) {
            setDenied(true);
            setOrders([]);
            setNextAfter(null);
            setSelectedId(null);
          }
          return null;
        }
        if (!response.ok) throw new Error('Queue unavailable');
        return response.json() as Promise<{ orders: ReviewOrder[]; nextAfter: string | null }>;
      })
      .then((value) => {
        if (!controller.signal.aborted && value) {
          setOrders((current) => {
            if (!after) return value.orders;
            const shown = new Set(current.map((order) => order.orderId));
            return [...current, ...value.orders.filter((order) => !shown.has(order.orderId))];
          });
          setNextAfter(value.nextAfter);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [after, revision, queueView]);

  useEffect(() => {
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
  }, [selectedId, revision]);

  function choose(decision: Decision) {
    if (!detail || (decision !== 'approve' && !reason.trim())) return;
    setAction({
      title: copy(decision),
      description: copy('confirm'),
      path: `/api/staff/electricity/orders/${encodeURIComponent(detail.orderId)}/${decision}`,
      method: 'POST',
      body: {
        idempotencyKey: crypto.randomUUID(),
        expectedVersionId: detail.versionId,
        ...(decision === 'approve' ? {} : { reason: reason.trim() }),
      },
      conflictMessage: copy('conflict'),
      forbiddenMessage: copy('forbidden'),
    });
  }

  const selectedTemplate = detail ? contractTemplate(detail.contractSnapshot) : null;

  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy('title')}</h1>
          <p className="text-muted-foreground">{copy('description')}</p>
        </div>
        <Button variant="outline" onClick={refreshQueue}>
          {copy('refresh')}
        </Button>
      </header>
      <form className="flex flex-wrap items-end gap-3" onSubmit={lookupOrder}>
        <div className="min-w-64 flex-1 space-y-2">
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
      <nav className="flex gap-2" aria-label={copy('views')}>
        <Button
          variant={queueView === 'review' ? 'secondary' : 'outline'}
          onClick={() => {
            setQueueView('review');
            refreshQueue();
          }}
        >
          {copy('reviewView')}
        </Button>
        <Button
          variant={queueView === 'conversations' ? 'secondary' : 'outline'}
          onClick={() => {
            setQueueView('conversations');
            refreshQueue();
          }}
        >
          {copy('conversationView')}
        </Button>
      </nav>
      {time.notice}
      {loading ? <p role="status">{copy('loading')}</p> : null}
      {denied ? <p role="alert">{copy('forbidden')}</p> : null}
      {error ? <p role="alert">{copy('error')}</p> : null}
      {!loading && !denied && !error && orders.length === 0 && !selectedId ? (
        <p>{copy(queueView === 'conversations' ? 'emptyConversations' : 'empty')}</p>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(16rem,1fr)_minmax(24rem,2fr)]">
        <div
          className="space-y-3"
          aria-label={copy(queueView === 'conversations' ? 'conversationView' : 'queue')}
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
          {nextAfter && !error ? (
            <Button variant="outline" disabled={loading} onClick={() => setAfter(nextAfter)}>
              {copy('more')}
            </Button>
          ) : null}
        </div>
        {selectedId && !detail && !detailError ? (
          <p role="status">{copy('loadingDetail')}</p>
        ) : null}
        {detailError ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>{copy('detailError')}</p>
            <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
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
                commercialStatus={copy(`commercial.${detail.commercialStatus}`)}
                commercialTone={commercialStatusTone(detail.commercialStatus)}
                financialLabel={copy('financial')}
                financialStatus={copy(`financial.${detail.financialStatus}`)}
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
                  <Timeline
                    label={copy('timeline')}
                    items={detail.timeline.map((event) => ({
                      id: event.id,
                      title: appText(
                        electricityTimelineKeys[event.event] ??
                          'electricity.order.timeline.updated',
                        locale
                      ),
                      dateTime: event.at,
                      dateLabel: time.format(event.at),
                      description: [event.reason, event.comment].filter(Boolean).join(' · '),
                    }))}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{copy('emptyTimeline')}</p>
                )}
              </section>
              <div className="overflow-x-auto">
                <h3 className="mb-2 font-medium">{copy('products')}</h3>
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
                        {copy('lineTotal')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pricingLines(detail.pricingSnapshot).map((line) => (
                      <tr key={line.systemKey} className="border-b">
                        <td className="p-2">{copy(`product.${line.systemKey}`)}</td>
                        <td className="p-2">{line.quantityKwh} kWh</td>
                        <td className="p-2">{numbers.money(line.unitPriceIrR)}</td>
                        <td className="p-2">{numbers.money(line.netIrR)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                    <Button onClick={() => choose('approve')}>{copy('approve')}</Button>
                    <Button
                      variant="outline"
                      disabled={!reason.trim()}
                      onClick={() => choose('request-changes')}
                    >
                      {copy('request-changes')}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={!reason.trim()}
                      onClick={() => choose('reject')}
                    >
                      {copy('reject')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setReason('');
            refreshQueue();
          }}
        />
      ) : null}
    </section>
  );
}
