import { useEffect, useState } from 'react';
import { Button, Card, CardContent, Input, Label } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { SavingOrderComments } from '../components/SavingOrderComments.js';
import { SavingOrderDocuments } from '../components/SavingOrderDocuments.js';
import {
  SavingOrderRevisionHistory,
  type SavingOrderRevision,
} from '../components/SavingOrderRevisionHistory.js';
import {
  SavingAddressAmendmentHistory,
  type SavingAddressAmendment,
} from '../components/SavingAddressAmendmentHistory.js';
import {
  SavingHardwareAmendmentHistory,
  type SavingHardwareAmendment,
} from '../components/SavingHardwareAmendmentHistory.js';
import { ContractCancellationRequestQueue } from '../components/ContractCancellationRequestQueue.js';
import {
  SavingHardwareUpgradeHistory,
  type SavingHardwareUpgrade,
} from '../components/SavingHardwareUpgradeHistory.js';

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
  financialStatus: string;
  submittedAt: string;
  billIdentifier: string;
  addressSnapshot: { full_address?: string };
  installationAddressId: string;
  hardwareProductId: string;
  hardwareTitle: { fa: string; en: string };
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
  revisions: SavingOrderRevision[];
  addressAmendments: SavingAddressAmendment[];
  hardwareAmendments: SavingHardwareAmendment[];
  hardwareUpgrades: SavingHardwareUpgrade[];
  addressOptions: Array<{ id: string; fullAddress: string; postalCode: string }>;
  hardwareOptions: Array<{
    id: string;
    title: { fa: string; en: string };
    priceDeltaIrR: string;
  }>;
  canAmendAddress: boolean;
  canAmendHardware: boolean;
}

function stagePrerequisites(stage: StageName, order: Detail) {
  const reasons: Array<
    'staffPaymentRequired' | 'staffActiveContractRequired' | 'staffUpgradePaymentRequired'
  > = [];
  if (
    (stage === 'product_delivery' || stage === 'process_completion') &&
    order.invoiceState !== 'Paid'
  )
    reasons.push('staffPaymentRequired');
  if (
    stage === 'product_delivery' &&
    order.hardwareUpgrades?.some((upgrade) => upgrade.status === 'awaiting_payment')
  )
    reasons.push('staffUpgradePaymentRequired');
  if (stage === 'process_completion' && !['Active', 'Completed'].includes(order.contractState))
    reasons.push('staffActiveContractRequired');
  return reasons;
}

export default function AdminSavingOrdersPage() {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const money = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  const [orders, setOrders] = useState<Order[]>([]);
  const [lane, setLane] = useState<'review' | 'fulfillment'>('review');
  const [after, setAfter] = useState<string | null>(null);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState('');
  const [handover, setHandover] = useState('');
  const [amendAddressId, setAmendAddressId] = useState('');
  const [amendReason, setAmendReason] = useState('');
  const [amendHardwareId, setAmendHardwareId] = useState('');
  const [amendHardwareReason, setAmendHardwareReason] = useState('');
  const [action, setAction] = useState<TeamAction | null>(null);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');

  function refreshQueue() {
    setOrders([]);
    setAfter(null);
    setNextAfter(null);
    setRevision((value) => value + 1);
  }

  function changeLane(value: 'review' | 'fulfillment') {
    if (value === lane) return;
    setLane(value);
    setOrders([]);
    setAfter(null);
    setNextAfter(null);
    setSelected(null);
  }

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    const params = new URLSearchParams({ lane });
    if (after) params.set('after', after);
    void fetch(`/api/staff/saving/orders?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 403) {
          if (!controller.signal.aborted) {
            setOrders([]);
            setNextAfter(null);
            setSelected(null);
            setState('forbidden');
          }
          return null;
        }
        if (!response.ok) throw new Error('queue');
        return response.json() as Promise<{ orders: Order[]; nextAfter: string | null }>;
      })
      .then((value) => {
        if (!controller.signal.aborted && value) {
          setOrders((current) => {
            if (!after) return value.orders;
            const shown = new Set(current.map((order) => order.id));
            return [...current, ...value.orders.filter((order) => !shown.has(order.id))];
          });
          setNextAfter(value.nextAfter);
          setState('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [after, lane, revision]);

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
        if (!controller.signal.aborted) {
          setDetail(value);
          setAmendAddressId(value.installationAddressId);
          setAmendHardwareId(value.hardwareOptions[0]?.id ?? '');
        }
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
      stagePrerequisites(stage, detail).length > 0 ||
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

  function amendAddress() {
    if (!detail || !amendReason.trim() || amendAddressId === detail.installationAddressId) return;
    setAction({
      title: copy('staffAmendAddress'),
      description: copy('staffConfirm'),
      method: 'POST',
      path: `/api/staff/saving/orders/${detail.id}/amend-address`,
      body: {
        idempotencyKey: crypto.randomUUID(),
        expectedVersionId: detail.versionId,
        expectedAddressId: detail.installationAddressId,
        addressId: amendAddressId,
        reason: amendReason.trim(),
      },
      conflictMessage: copy('staffConflict'),
      forbiddenMessage: copy('staffForbidden'),
    });
  }

  function amendHardware() {
    if (!detail || !amendHardwareReason.trim() || !amendHardwareId) return;
    setAction({
      title: copy('staffAmendHardware'),
      description: copy('staffConfirm'),
      method: 'POST',
      path: `/api/staff/saving/orders/${detail.id}/amend-hardware`,
      body: {
        idempotencyKey: crypto.randomUUID(),
        expectedVersionId: detail.versionId,
        expectedHardwareId: detail.hardwareProductId,
        hardwareProductId: amendHardwareId,
        reason: amendHardwareReason.trim(),
      },
      conflictMessage: copy('staffConflict'),
      forbiddenMessage: copy('staffForbidden'),
    });
  }

  function cancelHardwareUpgrade(upgrade: SavingHardwareUpgrade, reason: string) {
    if (!detail || !reason) return;
    setAction({
      title: copy('hardwareUpgradeCancel'),
      description: copy('staffConfirm'),
      method: 'POST',
      path: `/api/staff/saving/orders/${detail.id}/cancel-hardware-upgrade`,
      body: {
        idempotencyKey: crypto.randomUUID(),
        upgradeId: upgrade.id,
        reason,
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
        <Button variant="outline" onClick={refreshQueue}>
          {copy('staffRefresh')}
        </Button>
      </header>
      {time.notice}
      <div className="flex flex-wrap gap-2" aria-label={copy('staffQueue')}>
        <Button
          variant={lane === 'review' ? 'secondary' : 'outline'}
          aria-pressed={lane === 'review'}
          onClick={() => changeLane('review')}
        >
          {copy('staffReviewLane')}
        </Button>
        <Button
          variant={lane === 'fulfillment' ? 'secondary' : 'outline'}
          aria-pressed={lane === 'fulfillment'}
          onClick={() => changeLane('fulfillment')}
        >
          {copy('staffFulfillmentLane')}
        </Button>
      </div>
      {state === 'loading' && <p role="status">{copy('staffLoading')}</p>}
      {state === 'error' && <p role="alert">{copy('staffError')}</p>}
      {state === 'forbidden' && <p role="alert">{copy('staffForbidden')}</p>}
      <ContractCancellationRequestQueue
        service="savings"
        onOpenSavingOrder={(id) => {
          setSelected(id);
          setNote('');
          setHandover('');
        }}
      />
      {state === 'ready' && !orders.length && (
        <p>{copy(lane === 'review' ? 'staffReviewEmpty' : 'staffFulfillmentEmpty')}</p>
      )}
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
          {nextAfter && (
            <Button
              variant="outline"
              className="w-full"
              disabled={state !== 'ready'}
              onClick={() => setAfter(nextAfter)}
            >
              {copy('staffMoreOrders')}
            </Button>
          )}
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
                  <dt>{copy('stepHardware')}</dt>
                  <dd>{detail.hardwareTitle[locale]}</dd>
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
              <SavingOrderRevisionHistory
                revisions={detail.revisions ?? []}
                formatTimestamp={time.format}
              />
              <SavingAddressAmendmentHistory
                amendments={detail.addressAmendments ?? []}
                formatTimestamp={time.format}
              />
              <SavingHardwareAmendmentHistory
                amendments={detail.hardwareAmendments ?? []}
                formatTimestamp={time.format}
              />
              <SavingHardwareUpgradeHistory
                upgrades={detail.hardwareUpgrades ?? []}
                onCancel={cancelHardwareUpgrade}
              />
              {detail.canAmendAddress && (
                <div className="space-y-3 rounded-md border p-4">
                  <h3 className="font-semibold">{copy('staffAmendAddress')}</h3>
                  <p className="text-sm text-muted-foreground">{copy('staffAmendAddressHelp')}</p>
                  <Label htmlFor="saving-amend-address">{copy('stepAddress')}</Label>
                  <select
                    id="saving-amend-address"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={amendAddressId}
                    onChange={(event) => setAmendAddressId(event.target.value)}
                  >
                    {detail.addressOptions.map((address) => (
                      <option key={address.id} value={address.id}>
                        {address.fullAddress} · {address.postalCode}
                      </option>
                    ))}
                  </select>
                  <Label htmlFor="saving-amend-reason">{copy('staffAmendReason')}</Label>
                  <Input
                    id="saving-amend-reason"
                    value={amendReason}
                    maxLength={1000}
                    onChange={(event) => setAmendReason(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={
                      !amendReason.trim() || amendAddressId === detail.installationAddressId
                    }
                    onClick={amendAddress}
                  >
                    {copy('staffAmendAddress')}
                  </Button>
                </div>
              )}
              {detail.canAmendHardware && (
                <div className="space-y-3 rounded-md border p-4">
                  <h3 className="font-semibold">{copy('staffAmendHardware')}</h3>
                  <p className="text-sm text-muted-foreground">{copy('staffAmendHardwareHelp')}</p>
                  <Label htmlFor="saving-amend-hardware">{copy('stepHardware')}</Label>
                  <select
                    id="saving-amend-hardware"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={amendHardwareId}
                    onChange={(event) => setAmendHardwareId(event.target.value)}
                  >
                    {detail.hardwareOptions.map((hardware) => (
                      <option key={hardware.id} value={hardware.id}>
                        {hardware.title[locale]}
                        {BigInt(hardware.priceDeltaIrR) < 0n
                          ? ` · ${copy('hardwareCreditIssued')}: ${money.money((-BigInt(hardware.priceDeltaIrR)).toString())}`
                          : BigInt(hardware.priceDeltaIrR) > 0n
                            ? ` · ${copy('hardwareAdditionalCharge')}: ${money.money(hardware.priceDeltaIrR)}`
                            : ''}
                      </option>
                    ))}
                  </select>
                  <Label htmlFor="saving-amend-hardware-reason">{copy('staffAmendReason')}</Label>
                  <Input
                    id="saving-amend-hardware-reason"
                    value={amendHardwareReason}
                    maxLength={1000}
                    onChange={(event) => setAmendHardwareReason(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={!amendHardwareReason.trim() || !amendHardwareId}
                    onClick={amendHardware}
                  >
                    {copy('staffAmendHardware')}
                  </Button>
                </div>
              )}
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
                {detail.stages.map((stage) => {
                  const prerequisites = stagePrerequisites(stage.stage, detail);
                  return (
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
                                prerequisites.length > 0 ||
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
                      {stage.status === 'in_progress' && prerequisites.length > 0 && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {prerequisites.map((reason) => copy(reason)).join(' ')}
                        </p>
                      )}
                      {stage.handover_description && (
                        <p className="mt-2 text-sm">{stage.handover_description}</p>
                      )}
                    </li>
                  );
                })}
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
                          <time dateTime={event.created_at}>{time.format(event.created_at)}</time>
                        </span>
                        <span className="block">{event.explanation}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <SavingOrderDocuments orderId={detail.orderId} profileId={detail.profileId} staff />
              <SavingOrderComments
                key={detail.id}
                orderId={detail.id}
                staff
                formatTimestamp={time.format}
              />
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
            setAmendReason('');
            setAmendHardwareReason('');
            refreshQueue();
          }}
        />
      )}
    </section>
  );
}
