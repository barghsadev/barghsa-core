import { useEffect, useState } from 'react';
import { Button, Card, CardContent, Input, Label } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { SavingOrderComments } from '../components/SavingOrderComments.js';
import { SavingOrderDocuments } from '../components/SavingOrderDocuments.js';

type StageName =
  | 'request_confirmation'
  | 'product_delivery'
  | 'installation_and_document_upload'
  | 'equipment_handover'
  | 'process_completion';
interface Order {
  id: string;
  orderId: string;
  profileId: string;
  customerName: string;
  status: string;
  submittedAt: string;
  billIdentifier: string;
  addressSnapshot: { full_address?: string };
  pricingSnapshot: { plan?: { title?: { fa: string; en: string } } };
  versionId: string;
  invoiceState: string;
  contractState: string;
  totalIrR: string;
  paidIrR: string;
}
interface Stage {
  stage: StageName;
  status: string;
  completed_at: string | null;
  explanation: string | null;
  handover_description: string | null;
}
interface StageEvent {
  id: string;
  stage: StageName;
  from_status: string;
  to_status: string;
  actor_user_id: string;
  explanation: string;
  created_at: string;
}
interface Detail extends Order {
  stages: Stage[];
  events: StageEvent[];
}

export default function AdminSavingOrdersPage() {
  const locale = useLocale();
  const money = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState('');
  const [handover, setHandover] = useState('');
  const [action, setAction] = useState<TeamAction | null>(null);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    void fetch('/api/staff/saving/orders', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 403) {
          setState('forbidden');
          return null;
        }
        if (!response.ok) throw new Error('queue');
        return response.json() as Promise<{ orders: Order[] }>;
      })
      .then((value) => {
        if (!controller.signal.aborted && value) {
          setOrders(value.orders);
          setState('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    void fetch(`/api/staff/saving/orders/${encodeURIComponent(selected)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('detail');
        return response.json() as Promise<Detail>;
      })
      .then((value) => {
        if (!controller.signal.aborted) setDetail(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [selected, revision]);

  function review(decision: 'approve' | 'reject') {
    if (!detail || (decision === 'reject' && !note.trim())) return;
    setAction({
      title: copy(decision === 'approve' ? 'staffApprove' : 'staffReject'),
      description: copy('staffConfirm'),
      method: 'POST',
      path: `/api/staff/saving/orders/${detail.id}/${decision}`,
      body: {
        idempotencyKey: crypto.randomUUID(),
        expectedVersionId: detail.versionId,
        ...(decision === 'reject' ? { reason: note.trim() } : {}),
      },
      conflictMessage: copy('staffConflict'),
      forbiddenMessage: copy('staffForbidden'),
    });
  }

  function advance(stage: StageName, choice: 'complete' | 'skip') {
    if (
      !detail ||
      !note.trim() ||
      (stage === 'equipment_handover' && choice === 'complete' && !handover.trim())
    )
      return;
    setAction({
      title: copy(choice === 'skip' ? 'staffSkip' : 'staffComplete'),
      description: copy('staffConfirm'),
      method: 'POST',
      path: `/api/staff/saving/orders/${detail.id}/stages/${stage}/${choice}`,
      body: {
        idempotencyKey: crypto.randomUUID(),
        expectedStatus: 'in_progress',
        explanation: note.trim(),
        ...(handover.trim() ? { handoverDescription: handover.trim() } : {}),
      },
      conflictMessage: copy('staffConflict'),
      forbiddenMessage: copy('staffForbidden'),
    });
  }

  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy('staffTitle')}</h1>
          <p className="text-muted-foreground">{copy('staffDescription')}</p>
        </div>
        <Button variant="outline" onClick={() => setRevision((n) => n + 1)}>
          {copy('staffRefresh')}
        </Button>
      </header>
      {state === 'loading' && <p role="status">{copy('staffLoading')}</p>}
      {state === 'error' && <p role="alert">{copy('staffError')}</p>}
      {state === 'forbidden' && <p role="alert">{copy('staffForbidden')}</p>}
      {state === 'ready' && !orders.length && <p>{copy('staffEmpty')}</p>}
      <div className="grid gap-5 xl:grid-cols-[minmax(16rem,1fr)_minmax(24rem,2fr)]">
        <div className="space-y-2" aria-label={copy('staffQueue')}>
          {orders.map((order) => (
            <Button
              key={order.id}
              variant={selected === order.id ? 'secondary' : 'outline'}
              className="h-auto w-full justify-start whitespace-normal p-4 text-start"
              onClick={() => {
                setSelected(order.id);
                setNote('');
                setHandover('');
              }}
            >
              <span>
                <strong className="block">{order.customerName}</strong>
                <span className="block text-sm">
                  {order.pricingSnapshot.plan?.title?.[locale] ?? order.id}
                </span>
                <span className="block text-xs">
                  {copy(order.status)} · <bdi>{order.billIdentifier}</bdi>
                </span>
              </span>
            </Button>
          ))}
        </div>
        {selected && !detail && <p role="status">{copy('staffLoading')}</p>}
        {detail && (
          <Card>
            <CardContent className="space-y-5 pt-6">
              <div>
                <h2 className="text-xl font-semibold">{detail.customerName}</h2>
                <p className="text-sm text-muted-foreground">
                  {copy(detail.status)} · <bdi>{detail.id}</bdi>
                </p>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt>{copy('staffBill')}</dt>
                  <dd>
                    <bdi>{detail.billIdentifier}</bdi>
                  </dd>
                </div>
                <div>
                  <dt>{copy('staffAddress')}</dt>
                  <dd>{detail.addressSnapshot.full_address}</dd>
                </div>
                <div>
                  <dt>{copy('staffInvoice')}</dt>
                  <dd>
                    {copy(detail.invoiceState)} · {copy('staffTotal')}{' '}
                    {money.money(detail.totalIrR)} · {copy('staffPaid')}{' '}
                    {money.money(detail.paidIrR)}
                  </dd>
                </div>
                <div>
                  <dt>{copy('staffContract')}</dt>
                  <dd>{copy(detail.contractState)}</dd>
                </div>
              </dl>
              {detail.status === 'awaiting_staff_review' && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => review('approve')}>{copy('staffApprove')}</Button>
                  <Button
                    variant="destructive"
                    disabled={!note.trim()}
                    onClick={() => review('reject')}
                  >
                    {copy('staffReject')}
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="saving-staff-note">{copy('staffReason')}</Label>
                <Input
                  id="saving-staff-note"
                  value={note}
                  maxLength={1000}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
              {detail.stages.some(
                (stage) => stage.stage === 'equipment_handover' && stage.status === 'in_progress'
              ) && (
                <div className="space-y-2">
                  <Label htmlFor="saving-handover">{copy('staffHandover')}</Label>
                  <Input
                    id="saving-handover"
                    value={handover}
                    maxLength={1000}
                    onChange={(event) => setHandover(event.target.value)}
                  />
                </div>
              )}
              <ol className="space-y-2">
                {detail.stages.map((stage) => (
                  <li key={stage.stage} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <strong>{copy(stage.stage)}</strong> · {copy(stage.status)}
                      </span>
                      {stage.status === 'in_progress' && (
                        <span className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={
                              !note.trim() ||
                              (stage.stage === 'equipment_handover' && !handover.trim())
                            }
                            onClick={() => advance(stage.stage, 'complete')}
                          >
                            {copy('staffComplete')}
                          </Button>
                          {stage.stage === 'equipment_handover' && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!note.trim()}
                              onClick={() => advance(stage.stage, 'skip')}
                            >
                              {copy('staffSkip')}
                            </Button>
                          )}
                        </span>
                      )}
                    </div>
                    {stage.explanation && <p className="mt-2 text-sm">{stage.explanation}</p>}
                    {stage.handover_description && (
                      <p className="mt-2 text-sm">{stage.handover_description}</p>
                    )}
                  </li>
                ))}
              </ol>
              <div>
                <h3 className="font-semibold">{copy('staffHistory')}</h3>
                {detail.events.length === 0 ? (
                  <p className="text-sm">{copy('staffNoHistory')}</p>
                ) : (
                  <ol className="space-y-2 text-sm">
                    {detail.events.map((event) => (
                      <li key={event.id} className="border-s-2 ps-3">
                        <strong>{copy(event.stage)}</strong> · {copy(event.from_status)} →{' '}
                        {copy(event.to_status)}
                        <span className="block text-muted-foreground">
                          {event.actor_user_id} ·{' '}
                          <time dateTime={event.created_at}>
                            {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }).format(new Date(event.created_at))}
                          </time>
                        </span>
                        <span className="block">{event.explanation}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <SavingOrderDocuments orderId={detail.orderId} profileId={detail.profileId} staff />
              <SavingOrderComments key={detail.id} orderId={detail.id} staff />
            </CardContent>
          </Card>
        )}
      </div>
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setNote('');
            setHandover('');
            setRevision((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
