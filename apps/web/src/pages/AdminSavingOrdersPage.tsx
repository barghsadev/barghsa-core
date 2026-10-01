import { ListPage } from '@barghsa/ui';
import { t as appText } from '@barghsa/i18n/app';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, CardContent, FinancialReviewSummary, Input, Label } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { tSavingStaffReview } from '@barghsa/i18n/saving-staff-review';
import { t } from '@barghsa/i18n/app';
import {
  parseSavingAddressAmendmentReview,
  parseSavingHardwareAmendmentReview,
  parseSavingHardwareUpgradeCancellationReview,
  parseSavingFulfillmentStageReview,
  parseSavingStaffDecisionReview,
  type SavingAddressAmendmentReview,
  type SavingHardwareAmendmentReview,
  type SavingHardwareUpgradeCancellationReview,
  type SavingFulfillmentStageReview,
  type SavingStaffDecisionReview,
} from '@barghsa/shared/finance';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { withCsrf } from '../lib/csrf.js';
import { staffOrderId, type StaffOrderListQuery } from '../lib/staff-order-list-query.js';
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

function reviewPriceLines(snapshot: Record<string, unknown>) {
  return Array.isArray(snapshot.lines)
    ? snapshot.lines.filter(
        (
          line
        ): line is {
          title: { fa: string; en: string };
          amountIrR: string;
          discountIrR: string;
          netIrR: string;
          vatIrR: string;
        } =>
          !!line &&
          typeof line === 'object' &&
          !!line.title &&
          typeof line.title.fa === 'string' &&
          typeof line.title.en === 'string' &&
          ['amountIrR', 'discountIrR', 'netIrR', 'vatIrR'].every(
            (key) => typeof line[key] === 'string'
          )
      )
    : [];
}

export default function AdminSavingOrdersPage({ queries }: { queries?: StaffOrderListQuery } = {}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const money = useNumberFormatting(locale);
  const copy = (key: string) => tSavingStaffReview(key, locale) ?? tSaving(key, locale);
  const [accepted, setAccepted] = useState<{
    criteria: string;
    cursor: string | null;
    orders: Order[];
    nextAfter: string | null;
  } | null>(null);
  const [localLane, setLocalLane] = useState<'review' | 'fulfillment'>('review');
  const lane = queries?.queue.query.filters.lane || localLane;
  const orders = accepted?.criteria === lane ? accepted.orders : [];
  const nextAfter = accepted?.criteria === lane ? accepted.nextAfter : null;
  const [localAfter, setLocalAfter] = useState<string | null>(null);
  const after = queries ? queries.queue.query.cursor || null : localAfter;
  const setAfter = (value: string | null) =>
    queries ? queries.queue.setQuery({ cursor: value ?? '' }) : setLocalAfter(value);
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const selected = queries ? queries.selected : localSelected;
  const setSelected = (id: string | null, replace = false) =>
    queries ? queries.select(id, replace) : setLocalSelected(id);
  const [loadedDetail, setDetail] = useState<Detail | null>(null);
  const detail = loadedDetail?.id === selected ? loadedDetail : null;
  const [note, setNote] = useState('');
  const [handover, setHandover] = useState('');
  const [amendAddressId, setAmendAddressId] = useState('');
  const [amendReason, setAmendReason] = useState('');
  const [amendHardwareId, setAmendHardwareId] = useState('');
  const [amendHardwareReason, setAmendHardwareReason] = useState('');
  const [action, setAction] = useState<TeamAction | null>(null);
  const [decisionReview, setDecisionReview] = useState<SavingStaffDecisionReview | null>(null);
  const [addressReview, setAddressReview] = useState<SavingAddressAmendmentReview | null>(null);
  const [hardwareReview, setHardwareReview] = useState<SavingHardwareAmendmentReview | null>(null);
  const [upgradeCancellationReview, setUpgradeCancellationReview] =
    useState<SavingHardwareUpgradeCancellationReview | null>(null);
  const [stageReview, setStageReview] = useState<SavingFulfillmentStageReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState(false);
  const [addressReviewLoading, setAddressReviewLoading] = useState(false);
  const [addressReviewError, setAddressReviewError] = useState(false);
  const [hardwareReviewLoading, setHardwareReviewLoading] = useState(false);
  const [hardwareReviewError, setHardwareReviewError] = useState(false);
  const [upgradeCancellationReviewLoading, setUpgradeCancellationReviewLoading] = useState(false);
  const [upgradeCancellationReviewError, setUpgradeCancellationReviewError] = useState(false);
  const [stageReviewLoading, setStageReviewLoading] = useState(false);
  const [stageReviewError, setStageReviewError] = useState(false);
  const reviewRequest = useRef(0);
  const [revision, setRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [detailError, setDetailError] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');

  function refreshQueue() {
    setAccepted(null);
    setAfter(null);
    setRevision((value) => value + 1);
  }

  function changeLane(value: 'review' | 'fulfillment') {
    if (value === lane) return;
    if (queries) queries.changeLane(value);
    else {
      setLocalLane(value);
      setLocalAfter(null);
      setSelected(null);
    }
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
        if (response.status === 401 || response.status === 403) {
          if (!controller.signal.aborted) {
            setAccepted(null);
            setSelected(null, true);
            reviewRequest.current += 1;
            setDetail(null);
            setState('forbidden');
          }
          return null;
        }
        if (!response.ok) throw new Error('queue');
        return response.json() as Promise<{ orders: Order[]; nextAfter: string | null }>;
      })
      .then((value) => {
        if (!controller.signal.aborted && value) {
          setAccepted((current) => {
            const extending =
              !!after &&
              current?.criteria === lane &&
              current.nextAfter === after &&
              current.cursor !== after;
            const previous = extending ? current.orders : [];
            const shown = new Set(previous.map((order) => order.id));
            return {
              criteria: lane,
              cursor: after,
              orders: [...previous, ...value.orders.filter((order) => !shown.has(order.id))],
              nextAfter: staffOrderId(value.nextAfter) || null,
            };
          });
          setState('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [after, lane, revision, listRevision]);

  useEffect(() => {
    setNote('');
    setHandover('');
    setAmendReason('');
    setAmendHardwareReason('');
  }, [selected, lane]);

  useEffect(() => {
    reviewRequest.current++;
    setDetailError(false);
    setDecisionReview(null);
    setAddressReview(null);
    setHardwareReview(null);
    setUpgradeCancellationReview(null);
    setStageReview(null);
    setAction(null);
    setReviewLoading(false);
    setReviewError(false);
    setAddressReviewLoading(false);
    setAddressReviewError(false);
    setHardwareReviewLoading(false);
    setHardwareReviewError(false);
    setUpgradeCancellationReviewLoading(false);
    setUpgradeCancellationReviewError(false);
    setStageReviewLoading(false);
    setStageReviewError(false);
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
        if (!controller.signal.aborted) setDetailError(true);
      });
    return () => controller.abort();
  }, [selected, revision, detailRevision]);

  async function review(decision: 'approve' | 'reject') {
    if (!detail || reviewLoading || (decision === 'reject' && !note.trim())) return;
    const order = detail;
    const reason = decision === 'reject' ? note.trim() : '';
    const request = ++reviewRequest.current;
    setReviewLoading(true);
    setReviewError(false);
    try {
      const response = await fetch(
        `/api/staff/saving/orders/${encodeURIComponent(order.id)}/financial-review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ action: decision, reason }),
        }
      );
      if (!response.ok) throw new Error('Review unavailable');
      const financialReview = parseSavingStaffDecisionReview(await response.json());
      if (request !== reviewRequest.current) return;
      if (
        !financialReview ||
        financialReview.data.action !== decision ||
        financialReview.data.reason !== reason ||
        financialReview.data.versionId !== order.versionId ||
        financialReview.scope.profileId !== order.profileId ||
        financialReview.scope.resourceId !== order.id
      )
        throw new Error('Review mismatch');
      setDecisionReview(financialReview);
      setAction({
        title: copy(decision === 'approve' ? 'staffApprove' : 'staffReject'),
        description: copy('staffReviewConfirm'),
        method: 'POST',
        path: `/api/staff/saving/orders/${order.id}/${decision}`,
        body: {
          idempotencyKey: crypto.randomUUID(),
          expectedVersionId: financialReview.data.versionId,
          expectedReviewHash: financialReview.hash,
          ...(decision === 'reject' ? { reason } : {}),
        },
        conflictMessage: copy('staffConflict'),
        forbiddenMessage: copy('staffForbidden'),
      });
    } catch {
      if (request === reviewRequest.current) {
        setDecisionReview(null);
        setReviewError(true);
      }
    } finally {
      if (request === reviewRequest.current) setReviewLoading(false);
    }
  }

  async function advance(stage: StageName, choice: 'complete' | 'skip') {
    if (
      !detail ||
      stageReviewLoading ||
      !note.trim() ||
      stagePrerequisites(stage, detail).length > 0 ||
      (stage === 'equipment_handover' && choice === 'complete' && !handover.trim())
    )
      return;
    const order = detail;
    const explanation = note.trim();
    const handoverDescription = handover.trim();
    const path = `/api/staff/saving/orders/${encodeURIComponent(order.id)}/stages/${stage}/${choice}`;
    const request = ++reviewRequest.current;
    setStageReviewLoading(true);
    setStageReviewError(false);
    try {
      const response = await fetch(`${path}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          expectedStatus: 'in_progress',
          explanation,
          ...(handoverDescription ? { handoverDescription } : {}),
        }),
      });
      if (!response.ok) throw new Error('Stage review unavailable');
      const financialReview = parseSavingFulfillmentStageReview(await response.json());
      if (request !== reviewRequest.current) return;
      if (
        !financialReview ||
        financialReview.scope.profileId !== order.profileId ||
        financialReview.scope.resourceId !== order.id ||
        financialReview.data.stage !== stage ||
        financialReview.data.action !== choice ||
        financialReview.data.explanation !== explanation ||
        financialReview.data.handoverDescription !== (handoverDescription || null)
      )
        throw new Error('Stage review mismatch');
      setStageReview(financialReview);
      setAction({
        title: copy(choice === 'skip' ? 'staffSkip' : 'staffComplete'),
        description: copy('staffStageReviewConfirm'),
        method: 'POST',
        path,
        body: {
          idempotencyKey: crypto.randomUUID(),
          expectedStatus: 'in_progress',
          expectedReviewHash: financialReview.hash,
          explanation,
          ...(handoverDescription ? { handoverDescription } : {}),
        },
        conflictMessage: copy('staffConflict'),
        forbiddenMessage: copy('staffForbidden'),
      });
    } catch {
      if (request === reviewRequest.current) {
        setStageReview(null);
        setStageReviewError(true);
      }
    } finally {
      if (request === reviewRequest.current) setStageReviewLoading(false);
    }
  }

  async function amendAddress() {
    if (
      !detail ||
      addressReviewLoading ||
      !amendReason.trim() ||
      amendAddressId === detail.installationAddressId
    )
      return;
    const order = detail;
    const reason = amendReason.trim();
    const addressId = amendAddressId;
    const request = ++reviewRequest.current;
    setAddressReviewLoading(true);
    setAddressReviewError(false);
    try {
      const response = await fetch(
        `/api/staff/saving/orders/${encodeURIComponent(order.id)}/amend-address-review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            expectedVersionId: order.versionId,
            expectedAddressId: order.installationAddressId,
            addressId,
            reason,
          }),
        }
      );
      if (!response.ok) throw new Error('Address amendment review unavailable');
      const financialReview = parseSavingAddressAmendmentReview(await response.json());
      if (request !== reviewRequest.current) return;
      if (
        !financialReview ||
        financialReview.scope.profileId !== order.profileId ||
        financialReview.scope.resourceId !== order.id ||
        financialReview.data.versionId !== order.versionId ||
        financialReview.data.previousAddressId !== order.installationAddressId ||
        financialReview.data.replacementAddressId !== addressId ||
        financialReview.data.reason !== reason
      )
        throw new Error('Address amendment review mismatch');
      setAddressReview(financialReview);
      setAction({
        title: copy('staffAmendAddress'),
        description: copy('staffAddressReviewConfirm'),
        method: 'POST',
        path: `/api/staff/saving/orders/${order.id}/amend-address`,
        body: {
          idempotencyKey: crypto.randomUUID(),
          expectedVersionId: order.versionId,
          expectedAddressId: order.installationAddressId,
          expectedReviewHash: financialReview.hash,
          addressId,
          reason,
        },
        conflictMessage: copy('staffConflict'),
        forbiddenMessage: copy('staffForbidden'),
      });
    } catch {
      if (request === reviewRequest.current) {
        setAddressReview(null);
        setAddressReviewError(true);
      }
    } finally {
      if (request === reviewRequest.current) setAddressReviewLoading(false);
    }
  }

  async function amendHardware() {
    if (!detail || hardwareReviewLoading || !amendHardwareReason.trim() || !amendHardwareId) return;
    const order = detail;
    const reason = amendHardwareReason.trim();
    const targetId = amendHardwareId;
    const request = ++reviewRequest.current;
    setHardwareReviewLoading(true);
    setHardwareReviewError(false);
    try {
      const response = await fetch(
        `/api/staff/saving/orders/${encodeURIComponent(order.id)}/amend-hardware-review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            expectedVersionId: order.versionId,
            expectedHardwareId: order.hardwareProductId,
            hardwareProductId: targetId,
            reason,
          }),
        }
      );
      if (!response.ok) throw new Error('Hardware review unavailable');
      const financialReview = parseSavingHardwareAmendmentReview(await response.json());
      if (request !== reviewRequest.current) return;
      if (
        !financialReview ||
        financialReview.scope.profileId !== order.profileId ||
        financialReview.scope.resourceId !== order.id ||
        financialReview.data.versionId !== order.versionId ||
        financialReview.data.currentHardwareId !== order.hardwareProductId ||
        financialReview.data.targetHardwareId !== targetId ||
        financialReview.data.reason !== reason
      )
        throw new Error('Hardware review mismatch');
      setHardwareReview(financialReview);
      setAction({
        title: copy('staffAmendHardware'),
        description: copy('staffHardwareReviewConfirm'),
        method: 'POST',
        path: `/api/staff/saving/orders/${order.id}/amend-hardware`,
        body: {
          idempotencyKey: crypto.randomUUID(),
          expectedVersionId: financialReview.data.versionId,
          expectedHardwareId: financialReview.data.currentHardwareId,
          expectedReviewHash: financialReview.hash,
          hardwareProductId: financialReview.data.targetHardwareId,
          reason,
        },
        conflictMessage: copy('staffConflict'),
        forbiddenMessage: copy('staffForbidden'),
      });
    } catch {
      if (request === reviewRequest.current) {
        setHardwareReview(null);
        setHardwareReviewError(true);
      }
    } finally {
      if (request === reviewRequest.current) setHardwareReviewLoading(false);
    }
  }

  async function cancelHardwareUpgrade(upgrade: SavingHardwareUpgrade, reason: string) {
    if (!detail || !reason || upgradeCancellationReviewLoading) return;
    const order = detail;
    const request = ++reviewRequest.current;
    setUpgradeCancellationReviewLoading(true);
    setUpgradeCancellationReviewError(false);
    try {
      const response = await fetch(
        `/api/staff/saving/orders/${encodeURIComponent(order.id)}/cancel-hardware-upgrade-review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ upgradeId: upgrade.id, reason }),
        }
      );
      if (!response.ok) throw new Error('Upgrade cancellation review unavailable');
      const financialReview = parseSavingHardwareUpgradeCancellationReview(await response.json());
      if (request !== reviewRequest.current) return;
      if (
        !financialReview ||
        financialReview.scope.profileId !== order.profileId ||
        financialReview.scope.resourceId !== order.id ||
        financialReview.data.upgradeId !== upgrade.id ||
        financialReview.data.adjustmentInvoiceId !== upgrade.adjustmentInvoiceId ||
        financialReview.data.reason !== reason
      )
        throw new Error('Upgrade cancellation review mismatch');
      setUpgradeCancellationReview(financialReview);
      setAction({
        title: copy('hardwareUpgradeCancel'),
        description: copy('staffUpgradeCancellationConfirm'),
        method: 'POST',
        path: `/api/staff/saving/orders/${order.id}/cancel-hardware-upgrade`,
        body: {
          idempotencyKey: crypto.randomUUID(),
          upgradeId: upgrade.id,
          expectedReviewHash: financialReview.hash,
          reason,
        },
        conflictMessage: copy('staffConflict'),
        forbiddenMessage: copy('staffForbidden'),
      });
    } catch {
      if (request === reviewRequest.current) {
        setUpgradeCancellationReview(null);
        setUpgradeCancellationReviewError(true);
      }
    } finally {
      if (request === reviewRequest.current) setUpgradeCancellationReviewLoading(false);
    }
  }

  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy('staffTitle')}</h1>
          <p className="text-muted-foreground">{copy('staffDescription')}</p>
        </div>
      </header>
      {time.notice}
      <ListPage>
        <ListPage.Toolbar
          filters={
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
          }
          actions={
            <Button variant="outline" onClick={refreshQueue} disabled={state === 'loading'}>
              {copy('staffRefresh')}
            </Button>
          }
        />
        <ContractCancellationRequestQueue
          service="savings"
          onOpenSavingOrder={(id) => {
            setSelected(id);
            setNote('');
            setHandover('');
          }}
        />
        <div className="grid gap-5 xl:grid-cols-[minmax(16rem,1fr)_minmax(24rem,2fr)]">
          <div className="space-y-2" aria-label={copy('staffQueue')}>
            <ListPage.Content
              loading={state === 'loading'}
              error={state === 'error' || state === 'forbidden'}
              empty={orders.length === 0}
              retainContent={orders.length > 0 && state !== 'forbidden'}
              loadingView={<p role="status">{copy('staffLoading')}</p>}
              errorView={
                state === 'forbidden' ? (
                  <p role="alert">{copy('staffForbidden')}</p>
                ) : (
                  <div className="space-y-2">
                    <p role="alert">{copy('staffError')}</p>
                    <Button variant="outline" onClick={() => setListRevision((value) => value + 1)}>
                      {appText('historyPagination.retry', locale)}
                    </Button>
                  </div>
                )
              }
              emptyView={
                <p>{copy(lane === 'review' ? 'staffReviewEmpty' : 'staffFulfillmentEmpty')}</p>
              }
            >
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
            </ListPage.Content>
            <ListPage.Pagination
              kind="cursor"
              hasMore={
                !!nextAfter &&
                state !== 'error' &&
                state !== 'forbidden' &&
                (state === 'loading' ||
                  (queries ? queries.queue.canAdvance(nextAfter) : nextAfter !== after))
              }
              loading={state === 'loading'}
              onNext={() => {
                if (!nextAfter) return;
                if (queries) queries.queue.next(nextAfter);
                else setAfter(nextAfter);
              }}
              previous={{
                enabled: state !== 'forbidden' && (queries?.queue.hasPrevious ?? false),
                onClick: () => queries?.queue.previous(),
                label: appText('historyPagination.previous', locale),
              }}
              label={appText('historyPagination.label', locale)}
              nextLabel={copy('staffMoreOrders')}
            />
          </div>
          {selected && !detail && !detailError && <p role="status">{copy('staffLoading')}</p>}
          {selected && detailError && (
            <div role="alert" className="space-y-2">
              <p>{copy('staffError')}</p>
              <Button variant="outline" onClick={() => setDetailRevision((value) => value + 1)}>
                {appText('historyPagination.retry', locale)}
              </Button>
            </div>
          )}
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
                  onCancel={(upgrade, reason) => void cancelHardwareUpgrade(upgrade, reason)}
                />
                {upgradeCancellationReviewLoading ? (
                  <p role="status">{copy('staffUpgradeCancellationLoading')}</p>
                ) : null}
                {upgradeCancellationReviewError ? (
                  <p role="alert">{copy('staffReviewError')}</p>
                ) : null}
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
                        !amendReason.trim() ||
                        amendAddressId === detail.installationAddressId ||
                        addressReviewLoading
                      }
                      onClick={() => void amendAddress()}
                    >
                      {copy('staffAmendAddress')}
                    </Button>
                    {addressReviewLoading ? (
                      <p role="status">{copy('staffAddressReviewLoading')}</p>
                    ) : null}
                    {addressReviewError ? <p role="alert">{copy('staffReviewError')}</p> : null}
                  </div>
                )}
                {detail.canAmendHardware && (
                  <div className="space-y-3 rounded-md border p-4">
                    <h3 className="font-semibold">{copy('staffAmendHardware')}</h3>
                    <p className="text-sm text-muted-foreground">
                      {copy('staffAmendHardwareHelp')}
                    </p>
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
                      disabled={
                        !amendHardwareReason.trim() || !amendHardwareId || hardwareReviewLoading
                      }
                      onClick={() => void amendHardware()}
                    >
                      {copy('staffAmendHardware')}
                    </Button>
                    {hardwareReviewLoading ? (
                      <p role="status">{copy('staffHardwareReviewLoading')}</p>
                    ) : null}
                    {hardwareReviewError ? <p role="alert">{copy('staffReviewError')}</p> : null}
                  </div>
                )}
                {detail.status === 'awaiting_staff_review' && (
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={reviewLoading} onClick={() => void review('approve')}>
                      {copy('staffApprove')}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={!note.trim() || reviewLoading}
                      onClick={() => void review('reject')}
                    >
                      {copy('staffReject')}
                    </Button>
                    {reviewLoading ? <p role="status">{copy('staffReviewLoading')}</p> : null}
                    {reviewError ? <p role="alert">{copy('staffReviewError')}</p> : null}
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
                                onClick={() => void advance(stage.stage, 'complete')}
                              >
                                {copy('staffComplete')}
                              </Button>
                              {stage.stage === 'equipment_handover' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!note.trim()}
                                  onClick={() => void advance(stage.stage, 'skip')}
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
                {stageReviewLoading ? <p role="status">{copy('staffStageReviewLoading')}</p> : null}
                {stageReviewError ? <p role="alert">{copy('staffReviewError')}</p> : null}
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
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          summary={
            decisionReview ? (
              <FinancialReviewSummary
                title={copy('staffReviewTitle')}
                rows={[
                  {
                    id: 'customer',
                    label: copy('customer'),
                    value: decisionReview.data.customerName,
                  },
                  {
                    id: 'profile',
                    label: copy('staffReviewProfile'),
                    value: decisionReview.data.profileName,
                  },
                  {
                    id: 'bill',
                    label: copy('staffBill'),
                    value: decisionReview.data.billIdentifier,
                  },
                  {
                    id: 'hardware',
                    label: copy('stepHardware'),
                    value: decisionReview.data.hardwareTitle[locale],
                  },
                  {
                    id: 'address',
                    label: copy('staffAddress'),
                    value: String(decisionReview.data.addressSnapshot.full_address ?? ''),
                  },
                  {
                    id: 'contract',
                    label: copy('staffReviewContractVersion'),
                    value: money.number(decisionReview.data.versionNumber),
                  },
                  {
                    id: 'invoice',
                    label: copy('staffInvoice'),
                    value: t(`invoices.state.${decisionReview.data.invoiceState}`, locale),
                  },
                  {
                    id: 'paid',
                    label: copy('staffPaid'),
                    value: money.money(decisionReview.data.paidAmount),
                  },
                  ...(decisionReview.data.refundedAmount !== '0'
                    ? [
                        {
                          id: 'refunded',
                          label: copy('staffReviewRefunded'),
                          value: money.money(decisionReview.data.refundedAmount),
                        },
                      ]
                    : []),
                  ...(decisionReview.data.pendingRefundAmount !== '0'
                    ? [
                        {
                          id: 'pending-refund',
                          label: copy('staffReviewPendingRefund'),
                          value: money.money(decisionReview.data.pendingRefundAmount),
                        },
                      ]
                    : []),
                  {
                    id: 'outcome',
                    label: copy('staffReviewOutcome'),
                    value: copy(`staffReviewOutcome.${decisionReview.data.outcome}`),
                  },
                  ...reviewPriceLines(decisionReview.data.pricingSnapshot).map((line, index) => ({
                    id: `price-${index}`,
                    label: line.title[locale],
                    value: (
                      <span className="space-y-1 text-sm">
                        <span className="block">
                          {copy('staffPrice')}: {money.money(line.amountIrR)}
                        </span>
                        <span className="block">
                          {copy('discount')}: {money.money(line.discountIrR)}
                        </span>
                        <span className="block">
                          {copy('staffReviewNet')}: {money.money(line.netIrR)}
                        </span>
                        <span className="block">
                          {copy('vat')}: {money.money(line.vatIrR)}
                        </span>
                      </span>
                    ),
                  })),
                  ...(decisionReview.data.refundAmount !== '0'
                    ? [
                        {
                          id: 'refund',
                          label: copy('staffReviewRefund'),
                          value: money.money(decisionReview.data.refundAmount),
                        },
                      ]
                    : []),
                  ...(decisionReview.data.releasesGiftCode
                    ? [
                        {
                          id: 'gift',
                          label: copy('giftCode'),
                          value: copy('staffReviewGiftRelease'),
                        },
                      ]
                    : []),
                ]}
                total={{
                  label: copy('staffTotal'),
                  value: money.money(decisionReview.data.invoiceTotal),
                }}
                notice={
                  <div className="space-y-2">
                    {decisionReview.data.reason ? <p>{decisionReview.data.reason}</p> : null}
                    <p className="whitespace-pre-wrap break-words" dir="auto">
                      {decisionReview.data.agreementSnapshot}
                    </p>
                  </div>
                }
              />
            ) : addressReview ? (
              <FinancialReviewSummary
                title={copy('staffAddressReviewTitle')}
                rows={[
                  {
                    id: 'customer',
                    label: copy('customer'),
                    value: addressReview.data.customerName,
                  },
                  {
                    id: 'profile',
                    label: copy('staffReviewProfile'),
                    value: addressReview.data.profileName,
                  },
                  {
                    id: 'bill',
                    label: copy('staffBill'),
                    value: addressReview.data.billIdentifier,
                  },
                  {
                    id: 'hardware',
                    label: copy('stepHardware'),
                    value: addressReview.data.hardwareTitle[locale],
                  },
                  {
                    id: 'previous-address',
                    label: copy('staffAddressReviewCurrent'),
                    value: String(addressReview.data.previousAddress.full_address ?? ''),
                  },
                  {
                    id: 'previous-postal',
                    label: copy('staffAddressReviewPostal'),
                    value: String(addressReview.data.previousAddress.postal_code ?? ''),
                  },
                  {
                    id: 'replacement-address',
                    label: copy('staffAddressReviewReplacement'),
                    value: addressReview.data.replacementAddress.full_address,
                  },
                  {
                    id: 'replacement-postal',
                    label: copy('staffAddressReviewPostal'),
                    value: addressReview.data.replacementAddress.postal_code,
                  },
                  {
                    id: 'contract',
                    label: copy('staffReviewContractVersion'),
                    value: money.number(addressReview.data.versionNumber),
                  },
                  {
                    id: 'invoice',
                    label: copy('staffInvoice'),
                    value: t(`invoices.state.${addressReview.data.invoiceState}`, locale),
                  },
                  {
                    id: 'paid',
                    label: copy('staffPaid'),
                    value: money.money(addressReview.data.paidAmountIrR),
                  },
                ]}
                total={{
                  label: copy('staffTotal'),
                  value: money.money(addressReview.data.invoiceTotalIrR),
                }}
                notice={
                  <div className="space-y-2">
                    <p>{copy('staffAddressReviewOutcome')}</p>
                    <p>{addressReview.data.reason}</p>
                    <p className="whitespace-pre-wrap break-words" dir="auto">
                      {addressReview.data.agreementSnapshot}
                    </p>
                  </div>
                }
              />
            ) : hardwareReview ? (
              <FinancialReviewSummary
                title={copy('staffHardwareReviewTitle')}
                rows={[
                  {
                    id: 'customer',
                    label: copy('customer'),
                    value: hardwareReview.data.customerName,
                  },
                  {
                    id: 'profile',
                    label: copy('staffReviewProfile'),
                    value: hardwareReview.data.profileName,
                  },
                  {
                    id: 'bill',
                    label: copy('staffBill'),
                    value: hardwareReview.data.billIdentifier,
                  },
                  {
                    id: 'address',
                    label: copy('staffAddress'),
                    value: String(hardwareReview.data.addressSnapshot.full_address ?? ''),
                  },
                  {
                    id: 'contract',
                    label: copy('staffReviewContractVersion'),
                    value: money.number(hardwareReview.data.versionNumber),
                  },
                  {
                    id: 'invoice',
                    label: copy('staffInvoice'),
                    value: t(`invoices.state.${hardwareReview.data.invoiceState}`, locale),
                  },
                  {
                    id: 'paid',
                    label: copy('staffPaid'),
                    value: money.money(hardwareReview.data.paidAmount),
                  },
                  {
                    id: 'current-hardware',
                    label: copy('staffHardwareCurrent'),
                    value: hardwareReview.data.currentHardwareTitle[locale],
                  },
                  {
                    id: 'current-price',
                    label: copy('staffHardwareCurrentPrice'),
                    value: money.money(hardwareReview.data.currentHardwarePriceIrR),
                  },
                  {
                    id: 'current-vat',
                    label: copy('staffHardwareCurrentVat'),
                    value: `${money.number(hardwareReview.data.currentHardwareVatRateBps / 100)}%`,
                  },
                  {
                    id: 'current-total',
                    label: copy('staffHardwareCurrentTotal'),
                    value: money.money(hardwareReview.data.currentOrderTotalIrR),
                  },
                  {
                    id: 'target-hardware',
                    label: copy('staffHardwareTarget'),
                    value: hardwareReview.data.targetHardwareTitle[locale],
                  },
                  {
                    id: 'target-price',
                    label: copy('staffHardwareTargetPrice'),
                    value: money.money(hardwareReview.data.targetHardwarePriceIrR),
                  },
                  {
                    id: 'target-vat',
                    label: copy('staffHardwareTargetVat'),
                    value: `${money.number(hardwareReview.data.targetHardwareVatRateBps / 100)}%`,
                  },
                  {
                    id: 'outcome',
                    label: copy('staffReviewOutcome'),
                    value: copy(`staffHardwareOutcome.${hardwareReview.data.outcome}`),
                  },
                  {
                    id: 'delta',
                    label: copy('staffHardwareDelta'),
                    value: money.money(
                      (hardwareReview.data.priceDeltaIrR.startsWith('-')
                        ? -BigInt(hardwareReview.data.priceDeltaIrR)
                        : BigInt(hardwareReview.data.priceDeltaIrR)
                      ).toString()
                    ),
                  },
                  ...(hardwareReview.data.targetStockTracking
                    ? [
                        {
                          id: 'availability',
                          label: copy('staffHardwareAvailable'),
                          value: money.number(hardwareReview.data.targetAvailableCount),
                        },
                      ]
                    : []),
                ]}
                total={{
                  label: copy('staffHardwareTargetTotal'),
                  value: money.money(hardwareReview.data.targetOrderTotalIrR),
                }}
                notice={
                  <div className="space-y-2">
                    <p>{hardwareReview.data.reason}</p>
                    <p className="whitespace-pre-wrap break-words" dir="auto">
                      {hardwareReview.data.agreementSnapshot}
                    </p>
                  </div>
                }
              />
            ) : upgradeCancellationReview ? (
              <FinancialReviewSummary
                title={copy('staffUpgradeCancellationTitle')}
                rows={[
                  {
                    id: 'customer',
                    label: copy('customer'),
                    value: upgradeCancellationReview.data.customerName,
                  },
                  {
                    id: 'profile',
                    label: copy('staffReviewProfile'),
                    value: upgradeCancellationReview.data.profileName,
                  },
                  {
                    id: 'bill',
                    label: copy('staffBill'),
                    value: upgradeCancellationReview.data.billIdentifier,
                  },
                  {
                    id: 'address',
                    label: copy('staffAddress'),
                    value: String(
                      upgradeCancellationReview.data.addressSnapshot.full_address ?? ''
                    ),
                  },
                  {
                    id: 'contract',
                    label: copy('staffReviewContractVersion'),
                    value: money.number(upgradeCancellationReview.data.versionNumber),
                  },
                  {
                    id: 'previous-hardware',
                    label: copy('staffHardwareCurrent'),
                    value: upgradeCancellationReview.data.previousHardware.title[locale],
                  },
                  {
                    id: 'replacement-hardware',
                    label: copy('staffHardwareTarget'),
                    value: upgradeCancellationReview.data.replacementHardware.title[locale],
                  },
                  {
                    id: 'invoice',
                    label: copy('staffInvoice'),
                    value: t(
                      `invoices.state.${upgradeCancellationReview.data.adjustmentInvoiceState}`,
                      locale
                    ),
                  },
                  {
                    id: 'paid',
                    label: copy('staffPaid'),
                    value: money.money(upgradeCancellationReview.data.invoicePaidIrR),
                  },
                  {
                    id: 'charge',
                    label: copy('hardwareAdditionalCharge'),
                    value: money.money(upgradeCancellationReview.data.additionalChargeIrR),
                  },
                  {
                    id: 'reservation',
                    label: copy('staffUpgradeCancellationReservation'),
                    value: copy(
                      upgradeCancellationReview.data.stockReserved
                        ? 'staffUpgradeCancellationRelease'
                        : 'staffUpgradeCancellationNoReservation'
                    ),
                  },
                ]}
                total={{
                  label: copy('staffTotal'),
                  value: money.money(upgradeCancellationReview.data.invoiceTotalIrR),
                }}
                notice={
                  <div className="space-y-2">
                    <p>{copy('staffUpgradeCancellationOutcome')}</p>
                    <p>{upgradeCancellationReview.data.reason}</p>
                    <p className="whitespace-pre-wrap break-words" dir="auto">
                      {upgradeCancellationReview.data.agreementSnapshot}
                    </p>
                  </div>
                }
              />
            ) : stageReview ? (
              <FinancialReviewSummary
                title={copy('staffStageReviewTitle')}
                rows={[
                  { id: 'customer', label: copy('customer'), value: stageReview.data.customerName },
                  {
                    id: 'profile',
                    label: copy('staffReviewProfile'),
                    value: stageReview.data.profileName,
                  },
                  {
                    id: 'stage',
                    label: copy('staffStageReviewStage'),
                    value: copy(stageReview.data.stage),
                  },
                  {
                    id: 'transition',
                    label: copy('staffStageReviewTransition'),
                    value: `${copy(stageReview.data.currentStatus)} → ${copy(stageReview.data.nextStatus)}`,
                  },
                  {
                    id: 'next',
                    label: copy('staffStageReviewNext'),
                    value: stageReview.data.nextStage
                      ? copy(stageReview.data.nextStage)
                      : copy('completed'),
                  },
                  {
                    id: 'contract',
                    label: copy('staffContract'),
                    value: copy(stageReview.data.contractState),
                  },
                  {
                    id: 'invoice',
                    label: copy('staffInvoice'),
                    value: t(`invoices.state.${stageReview.data.invoiceState}`, locale),
                  },
                  {
                    id: 'paid',
                    label: copy('staffPaid'),
                    value: money.money(stageReview.data.paidAmountIrR),
                  },
                  {
                    id: 'explanation',
                    label: copy('staffReason'),
                    value: stageReview.data.explanation,
                  },
                  ...(stageReview.data.handoverDescription
                    ? [
                        {
                          id: 'handover',
                          label: copy('staffHandover'),
                          value: stageReview.data.handoverDescription,
                        },
                      ]
                    : []),
                ]}
                total={{
                  label: copy('staffTotal'),
                  value: money.money(stageReview.data.invoiceTotalIrR),
                }}
                notice={
                  <p className="whitespace-pre-wrap break-words" dir="auto">
                    {stageReview.data.agreementSnapshot}
                  </p>
                }
              />
            ) : undefined
          }
          onClose={() => {
            setAction(null);
            setDecisionReview(null);
            setAddressReview(null);
            setHardwareReview(null);
            setUpgradeCancellationReview(null);
            setStageReview(null);
          }}
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
