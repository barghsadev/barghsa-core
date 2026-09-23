import { useEffect, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Card, CardContent, Input, Label } from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

interface ReviewOrder {
  orderId: string;
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
}

type Decision = 'approve' | 'request-changes' | 'reject';
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

export default function AdminElectricityOrdersPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => t(`admin.electricityOrders.${key}`, locale);
  const [orders, setOrders] = useState<ReviewOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewOrder | null>(null);
  const [reason, setReason] = useState('');
  const [action, setAction] = useState<TeamAction | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setDenied(false);
    void fetch('/api/staff/electricity/orders', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 403) {
          setDenied(true);
          return null;
        }
        if (!response.ok) throw new Error('Queue unavailable');
        return response.json() as Promise<{ orders: ReviewOrder[] }>;
      })
      .then((value) => {
        if (!controller.signal.aborted && value) setOrders(value.orders);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
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
        if (!controller.signal.aborted) setError(true);
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

  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy('title')}</h1>
          <p className="text-muted-foreground">{copy('description')}</p>
        </div>
        <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
          {copy('refresh')}
        </Button>
      </header>
      {loading ? <p role="status">{copy('loading')}</p> : null}
      {denied ? <p role="alert">{copy('forbidden')}</p> : null}
      {error ? <p role="alert">{copy('error')}</p> : null}
      {!loading && !denied && !error && orders.length === 0 ? <p>{copy('empty')}</p> : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(16rem,1fr)_minmax(24rem,2fr)]">
        <div className="space-y-3" aria-label={copy('queue')}>
          {orders.map((order) => (
            <Button
              key={order.orderId}
              variant={selectedId === order.orderId ? 'secondary' : 'outline'}
              className="h-auto w-full justify-start whitespace-normal p-4 text-start"
              onClick={() => {
                setSelectedId(order.orderId);
                setReason('');
              }}
            >
              <span className="space-y-1">
                <strong className="block">{order.customerName}</strong>
                <span className="block text-xs">{order.orderId}</span>
                <span className="block text-xs">
                  {copy(`priority.${order.priority ?? 'normal'}`)} ·{' '}
                  {numbers.number(order.ageHours ?? 0)} {copy('hours')}
                </span>
              </span>
            </Button>
          ))}
        </div>
        {selectedId && !detail ? <p role="status">{copy('loadingDetail')}</p> : null}
        {detail ? (
          <Card>
            <CardContent className="space-y-5 pt-6">
              <h2 className="text-lg font-semibold">{copy('detail')}</h2>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{copy('customer')}</dt>
                  <dd>{detail.customerName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('submitted')}</dt>
                  <dd>{new Date(detail.submittedAt).toLocaleString(locale)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('period')}</dt>
                  <dd>
                    {new Date(detail.periodStart).toLocaleDateString(locale)} –{' '}
                    {new Date(detail.periodEnd).toLocaleDateString(locale)}
                  </dd>
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
                  <dt className="text-muted-foreground">{copy('financial')}</dt>
                  <dd>{copy(`financial.${detail.financialStatus}`)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('commercial')}</dt>
                  <dd>{copy(`commercial.${detail.commercialStatus}`)}</dd>
                </div>
              </dl>
              <p className="text-sm">
                <strong>{copy('address')}: </strong>
                {detail.fullAddress}
              </p>
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
            setSelectedId(null);
            setReason('');
            setRevision((value) => value + 1);
          }}
        />
      ) : null}
    </section>
  );
}
