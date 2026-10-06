import { OrderWalletBalance } from '../components/OrderWalletBalance.js';
import { SavingFulfillmentHistory } from '../components/SavingFulfillmentProgress.js';
import type { SavingFulfillmentEvent } from '../lib/saving-fulfillment.js';
import { ListPage } from '@barghsa/ui';
import { t as appText } from '@barghsa/i18n/app';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button, Card, CardContent, FinancialReviewSummary, Input } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { tSavingStaffReview } from '@barghsa/i18n/saving-staff-review';
import { tSavingChange } from '@barghsa/i18n/saving-change';
import { SavingStaffOperationForm } from '../components/SavingStaffOperationForm.js';
import type { SavingOperationReview } from '../lib/saving-staff-operation-form.js';
import { SavingHardwareCommandForm } from '../components/SavingHardwareCommandForm.js';
import type {
  SavingHardwareDraftCache,
  SavingHardwareOption,
} from '../lib/saving-hardware-form.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@barghsa/ui/form';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { sameFormData } from '../lib/form-receipt.js';
import {
  matchedSavingAddressReceipt,
  publicSavingAddressError,
  definitiveSavingAddressRejection,
  type SavingAddressDraft,
} from '../lib/saving-address-amendment-form.js';
import { t } from '@barghsa/i18n/app';
import {
  parseSavingAddressAmendmentReview,
  type SavingAddressAmendmentReview,
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
  agreementSnapshot: string;
  refundedIrR: string;
  pendingRefundIrR: string;
  status: string;
  financialStatus: string;
  submittedAt: string;
  billIdentifier: string;
  addressSnapshot: { full_address?: string; [key: string]: unknown };
  installationAddressId: string;
  hardwareProductId: string;
  hardwareTitle: { fa: string; en: string };
  pricingSnapshot: { plan?: { title?: { fa: string; en: string } } };
  versionId: string;
  invoiceId: string;
  invoiceState: string;
  contractId: string;
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
interface Detail extends Order {
  stages: Stage[];
  events: SavingFulfillmentEvent[];
  eventsTruncated?: boolean;
  revisions: SavingOrderRevision[];
  addressAmendments: SavingAddressAmendment[];
  hardwareAmendments: SavingHardwareAmendment[];
  hardwareUpgrades: SavingHardwareUpgrade[];
  addressOptions: Array<{ id: string; fullAddress: string; postalCode: string }>;
  hardwareOptions: SavingHardwareOption[];
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
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const time = useAccountTime(locale);
  const money = useNumberFormatting(locale);
  const copy = (key: string) => tSavingStaffReview(key, locale) ?? tSaving(key, locale);
  const [accepted, setAccepted] = useState<{
    criteria: string;
    actor: string | null;
    profileRevision: number;
    cursor: string | null;
    orders: Order[];
    nextAfter: string | null;
  } | null>(null);
  const [localLane, setLocalLane] = useState<'review' | 'fulfillment'>('review');
  const lane = queries?.queue.query.filters.lane || localLane;
  const acceptedCurrent =
    accepted?.criteria === lane &&
    accepted.actor === actor &&
    accepted.profileRevision === profileRevision;
  const orders = acceptedCurrent ? accepted.orders : [];
  const nextAfter = acceptedCurrent ? accepted.nextAfter : null;
  const [localAfter, setLocalAfter] = useState<string | null>(null);
  const after = queries ? queries.queue.query.cursor || null : localAfter;
  const setAfter = (value: string | null) =>
    queries ? queries.queue.setQuery({ cursor: value ?? '' }) : setLocalAfter(value);
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const selected = queries ? queries.selected : localSelected;
  const setSelected = (id: string | null, replace = false) =>
    queries ? queries.select(id, replace) : setLocalSelected(id);
  const [loadedDetail, setDetail] = useState<Detail | null>(null);
  const sourceScope = JSON.stringify([actor, profileRevision, selected, lane]);
  const currentScope = useRef(sourceScope);
  currentScope.current = sourceScope;
  const withdrawnDraftScope = useRef<string | null>(null);
  const currentDraftScope = useRef(sourceScope);
  currentDraftScope.current = withdrawnDraftScope.current === sourceScope ? '' : sourceScope;
  const currentActor = useRef(actor);
  currentActor.current = actor;
  const currentProfileRevision = useRef(profileRevision);
  currentProfileRevision.current = profileRevision;
  const currentLane = useRef(lane);
  currentLane.current = lane;
  const [detailScope, setDetailScope] = useState('');
  const detail = loadedDetail?.id === selected && detailScope === sourceScope ? loadedDetail : null;
  const addressOwner = useRef<SavingAddressOwner | null>(null);
  const addressDraft = useRef<SavingAddressDraftCache | null>(null);
  if (addressDraft.current && addressDraft.current.baseScope !== sourceScope)
    addressDraft.current = null;
  const addressScope = JSON.stringify([
    sourceScope,
    detail?.profileId,
    detail?.versionId,
    detail?.installationAddressId,
  ]);
  const addressCurrentScope = useRef(addressScope);
  addressCurrentScope.current = addressScope;
  const [, setAddressLockRevision] = useState(0);
  const hardwareDrafts = useRef(new Map<string, SavingHardwareDraftCache>());
  for (const [id, draft] of hardwareDrafts.current) {
    if (draft.baseScope !== sourceScope) hardwareDrafts.current.delete(id);
  }
  const hardwareScope = JSON.stringify([
    sourceScope,
    detail?.profileId,
    detail?.versionId,
    detail?.hardwareProductId,
    detail?.hardwareTitle,
    detail?.billIdentifier,
    detail?.customerName,
    detail?.agreementSnapshot,
    detail?.refundedIrR,
    detail?.pendingRefundIrR,
    detail?.canAmendHardware,
    detail?.contractId,
    detail?.contractState,
    detail?.invoiceId,
    detail?.invoiceState,
    detail?.totalIrR,
    detail?.paidIrR,
    detail?.addressSnapshot,
    detail?.hardwareOptions,
    detail?.hardwareUpgrades,
  ]);
  const hardwareCurrentScope = useRef(hardwareScope);
  hardwareCurrentScope.current = hardwareScope;
  const operationScope = JSON.stringify([
    hardwareScope,
    detail?.status,
    detail?.pricingSnapshot,
    detail?.stages,
  ]);
  const operationCurrentScope = useRef(operationScope);
  operationCurrentScope.current = operationScope;
  const readEpoch = useRef(0);
  const queueAbort = useRef<AbortController | null>(null);
  const detailAbort = useRef<AbortController | null>(null);
  const navigationLocked = () =>
    !!addressOwner.current &&
    (!!addressOwner.current.kind ||
      addressOwner.current.attempted ||
      addressOwner.current.uncertain);

  const [note, setNote] = useState('');
  const [handover, setHandover] = useState('');
  const [revision, setRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [detailError, setDetailError] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');

  function refreshQueue() {
    if (navigationLocked()) return;
    setAfter(null);
    setRevision((value) => value + 1);
  }

  function changeLane(value: 'review' | 'fulfillment') {
    if (navigationLocked() || value === lane) return;
    if (queries) queries.changeLane(value);
    else {
      setLocalLane(value);
      setLocalAfter(null);
      setSelected(null);
    }
  }

  function withdrawSelected(reason: 'forbidden' | 'missing', id: string) {
    withdrawnDraftScope.current = sourceScope;
    ++readEpoch.current;
    queueAbort.current?.abort();
    detailAbort.current?.abort();
    addressDraft.current = null;
    hardwareDrafts.current.clear();
    setDetail(null);
    setDetailError(true);
    setNote('');
    setHandover('');
    if (reason === 'forbidden') {
      setAccepted(null);
      setState('forbidden');
      setSelected(null, true);
    } else {
      setAccepted((current) =>
        current ? { ...current, orders: current.orders.filter((row) => row.id !== id) } : null
      );
      setState(acceptedCurrent ? 'ready' : 'error');
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    queueAbort.current = controller;
    const epoch = readEpoch.current;
    const fresh = () =>
      !controller.signal.aborted &&
      epoch === readEpoch.current &&
      currentActor.current === actor &&
      currentProfileRevision.current === profileRevision &&
      currentLane.current === lane;
    setState('loading');
    const params = new URLSearchParams({ lane });
    if (after) params.set('after', after);
    void fetch(`/api/staff/saving/orders?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!fresh()) return null;
        if (response.status === 401 || response.status === 403) {
          if (fresh()) {
            setAccepted(null);
            setSelected(null, true);
            setDetail(null);
            setState('forbidden');
          }
          return null;
        }
        if (!response.ok) throw new Error('queue');
        return response.json() as Promise<{ orders: Order[]; nextAfter: string | null }>;
      })
      .then((value) => {
        if (fresh() && value) {
          setAccepted((current) => {
            const extending =
              !!after &&
              current?.criteria === lane &&
              current.actor === actor &&
              current.profileRevision === profileRevision &&
              current.nextAfter === after &&
              current.cursor !== after;
            const previous = extending ? current.orders : [];
            const shown = new Set(previous.map((order) => order.id));
            return {
              criteria: lane,
              actor,
              profileRevision,
              cursor: after,
              orders: [...previous, ...value.orders.filter((order) => !shown.has(order.id))],
              nextAfter: staffOrderId(value.nextAfter) || null,
            };
          });
          setState('ready');
        }
      })
      .catch(() => {
        if (fresh()) setState('error');
      });
    return () => controller.abort();
  }, [after, lane, revision, listRevision, actor, profileRevision]);

  useEffect(() => {
    setNote('');
    setHandover('');
  }, [selected, lane, actor, profileRevision]);

  useEffect(() => {
    setDetailError(false);
    if (!selected) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    detailAbort.current = controller;
    const epoch = readEpoch.current;
    const fresh = () =>
      !controller.signal.aborted &&
      epoch === readEpoch.current &&
      currentScope.current === sourceScope;
    setDetail(null);
    void fetch(`/api/staff/saving/orders/${encodeURIComponent(selected)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!fresh()) return null;
        if (response.status === 401 || response.status === 403) {
          withdrawSelected('forbidden', selected);
          return null;
        }
        if (response.status === 404) {
          withdrawSelected('missing', selected);
          return null;
        }
        if (!response.ok) throw new Error('detail');
        return response.json() as Promise<Detail>;
      })
      .then((value) => {
        if (fresh() && value) {
          withdrawnDraftScope.current = null;
          setDetail(value);
          setDetailScope(sourceScope);
        }
      })
      .catch(() => {
        if (fresh()) setDetailError(true);
      });
    return () => controller.abort();
  }, [sourceScope, revision, detailRevision]);

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
                disabled={navigationLocked()}
                onClick={() => changeLane('review')}
              >
                {copy('staffReviewLane')}
              </Button>
              <Button
                variant={lane === 'fulfillment' ? 'secondary' : 'outline'}
                aria-pressed={lane === 'fulfillment'}
                disabled={navigationLocked()}
                onClick={() => changeLane('fulfillment')}
              >
                {copy('staffFulfillmentLane')}
              </Button>
            </div>
          }
          actions={
            <Button
              variant="outline"
              onClick={refreshQueue}
              disabled={state === 'loading' || navigationLocked()}
            >
              {copy('staffRefresh')}
            </Button>
          }
        />
        <ContractCancellationRequestQueue
          service="savings"
          onOpenSavingOrder={(id) => {
            if (navigationLocked()) return;
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
                    <Button
                      variant="outline"
                      disabled={navigationLocked()}
                      onClick={() => {
                        if (!navigationLocked()) setListRevision((value) => value + 1);
                      }}
                    >
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
                  disabled={navigationLocked()}
                  onClick={() => {
                    if (navigationLocked()) return;
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
                !navigationLocked() &&
                !!nextAfter &&
                state !== 'error' &&
                state !== 'forbidden' &&
                (state === 'loading' ||
                  (nextAfter === after && accepted?.cursor !== after) ||
                  (queries ? queries.queue.canAdvance(nextAfter) : nextAfter !== after))
              }
              loading={state === 'loading'}
              onNext={() => {
                if (navigationLocked() || !nextAfter) return;
                if (after === nextAfter && accepted?.cursor !== after)
                  setListRevision((value) => value + 1);
                else if (queries) queries.queue.next(nextAfter);
                else setAfter(nextAfter);
              }}
              previous={{
                enabled:
                  !navigationLocked() &&
                  state !== 'forbidden' &&
                  (queries?.queue.hasPrevious ?? false),
                onClick: () => {
                  if (!navigationLocked()) queries?.queue.previous();
                },
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
              <Button
                variant="outline"
                disabled={navigationLocked()}
                onClick={() => {
                  if (!navigationLocked()) setDetailRevision((value) => value + 1);
                }}
              >
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
                <OrderWalletBalance
                  profileId={detail.profileId}
                  total={
                    ['rejected', 'cancelled', 'completed'].includes(detail.status) ||
                    detail.invoiceState === 'PaymentUnderReview'
                      ? '0'
                      : detail.totalIrR
                  }
                  paid={detail.paidIrR}
                  invoiceId={detail.invoiceId}
                  scopeKey={JSON.stringify([sourceScope, detail.id, detail.versionId])}
                  staff
                />
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
                  renderCancel={(upgrade) => (
                    <SavingHardwareCommandForm
                      key={`${hardwareScope}:${upgrade.id}`}
                      upgrade={upgrade}
                      order={detail}
                      owner={addressOwner}
                      scope={hardwareScope}
                      currentScope={hardwareCurrentScope}
                      draftCache={hardwareDrafts}
                      baseScope={sourceScope}
                      currentBaseScope={currentDraftScope}
                      blocked={() => !!addressOwner.current}
                      notify={() => setAddressLockRevision((value) => value + 1)}
                      onPending={() => {
                        ++readEpoch.current;
                        queueAbort.current?.abort();
                        detailAbort.current?.abort();
                        if (accepted) setState('ready');
                      }}
                      onSuccess={refreshQueue}
                      onWithdraw={(reason) => withdrawSelected(reason, detail.id)}
                    />
                  )}
                />
                {detail.canAmendAddress && (
                  <PaidSavingAddressForm
                    key={addressScope}
                    order={detail}
                    owner={addressOwner}
                    scope={addressScope}
                    currentScope={addressCurrentScope}
                    draftCache={addressDraft}
                    baseScope={sourceScope}
                    currentBaseScope={currentDraftScope}
                    blocked={() => !!addressOwner.current?.kind}
                    notify={() => setAddressLockRevision((value) => value + 1)}
                    onPending={() => {
                      ++readEpoch.current;
                      queueAbort.current?.abort();
                      detailAbort.current?.abort();
                      if (accepted) setState('ready');
                    }}
                    onSuccess={refreshQueue}
                    onWithdraw={(reason) => withdrawSelected(reason, detail.id)}
                  />
                )}
                {detail.canAmendHardware && (
                  <SavingHardwareCommandForm
                    key={`${hardwareScope}:hardware`}
                    order={detail}
                    owner={addressOwner}
                    scope={hardwareScope}
                    currentScope={hardwareCurrentScope}
                    draftCache={hardwareDrafts}
                    baseScope={sourceScope}
                    currentBaseScope={currentDraftScope}
                    blocked={() => !!addressOwner.current}
                    notify={() => setAddressLockRevision((value) => value + 1)}
                    onPending={() => {
                      ++readEpoch.current;
                      queueAbort.current?.abort();
                      detailAbort.current?.abort();
                      if (accepted) setState('ready');
                    }}
                    onSuccess={refreshQueue}
                    onWithdraw={(reason) => withdrawSelected(reason, detail.id)}
                  />
                )}
                <SavingStaffOperationForm
                  key={operationScope}
                  order={detail}
                  draft={{ note, handover }}
                  onDraft={(value) => {
                    if (operationCurrentScope.current !== operationScope) return;
                    setNote(value.note);
                    setHandover(value.handover);
                  }}
                  owner={addressOwner}
                  scope={operationScope}
                  currentScope={operationCurrentScope}
                  notify={() => setAddressLockRevision((value) => value + 1)}
                  onPending={() => {
                    ++readEpoch.current;
                    queueAbort.current?.abort();
                    detailAbort.current?.abort();
                    setState(acceptedCurrent ? 'ready' : 'error');
                  }}
                  onSuccess={refreshQueue}
                  onWithdraw={(reason) => withdrawSelected(reason, detail.id)}
                  prerequisites={(stage) =>
                    stagePrerequisites(stage, detail).map((reason) => copy(reason))
                  }
                  summary={(review) => <SavingStaffOperationSummary review={review} />}
                />
                <SavingFulfillmentHistory
                  events={detail.events}
                  truncated={detail.eventsTruncated}
                  locale={locale}
                  formatTimestamp={time.format}
                />
                <SavingOrderDocuments orderId={detail.orderId} profileId={detail.profileId} staff />
                <SavingOrderComments
                  key={detail.id}
                  orderId={detail.id}
                  profileId={detail.profileId}
                  sourceVersion={JSON.stringify([lane, detail.versionId])}
                  staff
                  formatTimestamp={time.format}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </ListPage>
    </section>
  );
}

function SavingStaffOperationSummary({ review }: { review: SavingOperationReview }) {
  const locale = useLocale();
  const money = useNumberFormatting(locale);
  const copy = (key: string) => tSavingStaffReview(key, locale) ?? tSaving(key, locale);
  const decisionReview = review.kind === 'decision' ? review.value : null;
  const stageReview = review.kind === 'stage' ? review.value : null;
  return decisionReview ? (
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
          value: stageReview.data.nextStage ? copy(stageReview.data.nextStage) : copy('completed'),
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
  ) : undefined;
}

function SavingAddressReviewSummary({
  addressReview,
}: {
  addressReview: SavingAddressAmendmentReview;
}) {
  const locale = useLocale();
  const money = useNumberFormatting(locale);
  const copy = (key: string) => tSavingStaffReview(key, locale) ?? tSaving(key, locale);
  return (
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
  );
}

interface SavingAddressOwner {
  kind?: 'hardware' | 'cancellation' | 'decision' | 'stage';
  attempted: boolean;
  uncertain: boolean;
}
interface SavingAddressDraftCache {
  baseScope: string;
  scope: string;
  value: SavingAddressDraft;
}
interface SavingAddressCommand {
  action: TeamAction;
  review: SavingAddressAmendmentReview;
  owner: SavingAddressOwner;
  rejected: boolean;
}
function PaidSavingAddressForm({
  order,
  owner,
  scope,
  currentScope,
  draftCache,
  baseScope,
  currentBaseScope,
  blocked,
  notify,
  onPending,
  onSuccess,
  onWithdraw,
}: {
  order: Detail;
  owner: RefObject<SavingAddressOwner | null>;
  scope: string;
  currentScope: RefObject<string>;
  draftCache: RefObject<SavingAddressDraftCache | null>;
  baseScope: string;
  currentBaseScope: RefObject<string>;
  blocked: () => boolean;
  notify: () => void;
  onPending: () => void;
  onSuccess: () => void;
  onWithdraw: (reason: 'forbidden' | 'missing') => void;
}) {
  const locale = useLocale();
  const copy = (key: string) => tSavingStaffReview(key, locale) ?? tSaving(key, locale);
  const formCopy = (key: string) => tSavingChange(key, locale);
  const mounted = useRef(false);
  const request = useRef(0);
  const preparing = useRef(false);
  const pending = useRef(false);
  const captured = useRef<SavingAddressCommand | null>(null);
  const operationOwner = useRef<SavingAddressOwner | null>(null);
  const privateWithdrawn = useRef(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [review, setReview] = useState<SavingAddressAmendmentReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const messages = {
    addressId: formCopy('staffAddressInvalid'),
    reason: formCopy('staffReasonInvalid'),
  };
  const form: ReturnType<typeof useZodForm<SavingAddressDraft>> = useZodForm<SavingAddressDraft>(
    async () => {
      const raw = JSON.stringify(form.getValues());
      const generation = request.current;
      const schemas = await import('../lib/saving-address-amendment-form-schemas.js');
      return currentScope.current === scope &&
        generation === request.current &&
        raw === JSON.stringify(form.getValues())
        ? schemas.savingAddressSchema(
            order.installationAddressId,
            order.addressOptions.map((option) => option.id),
            messages
          )
        : schemas.inactiveSavingAddressSchema;
    },
    {
      defaultValues:
        draftCache.current?.scope === scope
          ? draftCache.current.value
          : { addressId: order.installationAddressId, reason: '' },
      validationUnavailableMessage: formCopy('validationUnavailable'),
    }
  );
  const applyFields = useActionFieldErrors(form, messages, copy('staffReviewError'));
  const active = () =>
    mounted.current && currentScope.current === scope && !privateWithdrawn.current;
  useEffect(() => {
    mounted.current = true;
    return () => {
      if (!privateWithdrawn.current && currentBaseScope.current === baseScope)
        draftCache.current = { baseScope, scope, value: form.getValues() };
      mounted.current = false;
      ++request.current;
      if (owner.current === operationOwner.current) {
        owner.current = null;
        notify();
      }
    };
  }, []);
  function release() {
    ++request.current;
    preparing.current = false;
    pending.current = false;
    captured.current = null;
    if (owner.current === operationOwner.current) owner.current = null;
    operationOwner.current = null;
    setAction(null);
    setReview(null);
    setBusy(false);
    setUncertain(false);
    notify();
  }
  function withdraw(reason: 'forbidden' | 'missing') {
    if (!active()) return;
    privateWithdrawn.current = true;
    draftCache.current = null;
    form.reset({ addressId: '', reason: '' });
    release();
    onWithdraw(reason);
  }
  function live(command: SavingAddressCommand, ownedAction: TeamAction) {
    return (
      active() &&
      captured.current === command &&
      command.action === ownedAction &&
      owner.current === command.owner
    );
  }
  function unconfirmed(command: SavingAddressCommand, ownedAction: TeamAction) {
    if (!live(command, ownedAction)) return;
    command.owner.uncertain = true;
    pending.current = false;
    setUncertain(true);
    setAction(null);
    setReview(null);
    notify();
  }
  function close(command: SavingAddressCommand, ownedAction: TeamAction) {
    if (!live(command, ownedAction) || pending.current) return;
    if (command.owner.uncertain || (command.owner.attempted && !command.rejected))
      unconfirmed(command, ownedAction);
    else release();
  }
  function decorate(command: SavingAddressCommand, ownedAction: TeamAction) {
    ownedAction.errorMessages = Object.fromEntries(
      [
        ErrorCodes.VALIDATION_INPUT_INVALID.code,
        'VALIDATION:INPUT_INVALID',
        ErrorCodes.CONFLICT_STATE.code,
        ErrorCodes.CONFLICT_VERSION.code,
        ErrorCodes.NOT_FOUND_RESOURCE.code,
      ].map((code) => [
        code,
        (value: unknown) => {
          if (!live(command, ownedAction)) return copy('staffReviewError');
          if (publicSavingAddressError(value)?.code === ErrorCodes.NOT_FOUND_RESOURCE.code) {
            withdraw('missing');
            return formCopy('staffMissing');
          }
          const rejection = definitiveSavingAddressRejection(value);
          if (rejection) {
            command.rejected = true;
            if (
              !command.owner.uncertain &&
              rejection.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
              Array.isArray(rejection.fields) &&
              applyFields(rejection.fields)
            ) {
              pending.current = false;
              close(command, ownedAction);
            }
          }
          return copy(code.startsWith('CONFLICT:') ? 'staffConflict' : 'staffReviewError');
        },
      ])
    );
  }
  function prepare() {
    if (
      !active() ||
      preparing.current ||
      pending.current ||
      captured.current ||
      owner.current ||
      blocked() ||
      form.isSubmissionPending() ||
      !order.canAmendAddress
    )
      return;
    const token = { attempted: false, uncertain: false };
    owner.current = token;
    operationOwner.current = token;
    preparing.current = true;
    setBusy(true);
    setError(false);
    notify();
    const generation = ++request.current;
    const raw = JSON.stringify(form.getValues());
    const authorized = () => active() && request.current === generation && owner.current === token;
    const fresh = () => authorized() && raw === JSON.stringify(form.getValues());
    void form
      .handleSubmit(async (draft) => {
        if (!fresh() || JSON.stringify(draft) !== raw) return;
        const body = {
          expectedVersionId: order.versionId,
          expectedAddressId: order.installationAddressId,
          addressId: draft.addressId,
          reason: draft.reason.trim(),
        };
        try {
          const response = await fetch(
            `/api/staff/saving/orders/${encodeURIComponent(order.id)}/amend-address-review`,
            {
              method: 'POST',
              credentials: 'include',
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(body),
            }
          );
          if (!authorized()) return;
          if ([401, 403].includes(response.status)) {
            withdraw('forbidden');
            return;
          }
          if (response.status === 404) {
            withdraw('missing');
            return;
          }
          const value: unknown = await response.json().catch(() => null);
          if (!fresh()) return;
          if (response.status === 400 && definitiveSavingAddressRejection(value)) {
            const fields = publicSavingAddressError(value)?.fields;
            if (Array.isArray(fields) && applyFields(fields)) return;
          }
          if (response.status !== 200) throw new Error('review');
          const financialReview = parseSavingAddressAmendmentReview(value);
          const replacementOption = order.addressOptions.find(
            (option) => option.id === body.addressId
          );
          if (
            !financialReview ||
            financialReview.scope.profileId !== order.profileId ||
            financialReview.scope.resourceId !== order.id ||
            financialReview.data.orderId !== order.orderId ||
            financialReview.data.billIdentifier !== order.billIdentifier ||
            financialReview.data.contractId !== order.contractId ||
            financialReview.data.contractState !== order.contractState ||
            financialReview.data.versionId !== order.versionId ||
            financialReview.data.invoiceId !== order.invoiceId ||
            financialReview.data.invoiceState !== order.invoiceState ||
            financialReview.data.previousAddressId !== order.installationAddressId ||
            !sameFormData(financialReview.data.previousAddress, order.addressSnapshot) ||
            financialReview.data.replacementAddressId !== body.addressId ||
            financialReview.data.replacementAddress.full_address !==
              replacementOption?.fullAddress ||
            financialReview.data.replacementAddress.postal_code !== replacementOption?.postalCode ||
            financialReview.data.reason !== body.reason ||
            financialReview.data.invoiceTotalIrR !== order.totalIrR ||
            financialReview.data.paidAmountIrR !== order.paidIrR
          )
            throw new Error('review mismatch');
          const ownedAction: TeamAction = {
            title: copy('staffAmendAddress'),
            description: copy('staffAddressReviewConfirm'),
            method: 'POST',
            path: `/api/staff/saving/orders/${order.id}/amend-address`,
            successStatus: 201,
            body: {
              ...body,
              idempotencyKey: crypto.randomUUID(),
              expectedReviewHash: financialReview.hash,
            },
            conflictMessage: copy('staffConflict'),
            forbiddenMessage: copy('staffForbidden'),
          };
          const command = {
            action: ownedAction,
            review: financialReview,
            owner: token,
            rejected: false,
          };
          captured.current = command;
          decorate(command, ownedAction);
          setReview(financialReview);
          setAction(ownedAction);
        } catch {
          if (fresh()) setError(true);
        }
      })()
      .finally(() => {
        if (active() && request.current === generation) {
          preparing.current = false;
          setBusy(false);
          if (!captured.current && owner.current === token) {
            owner.current = null;
            operationOwner.current = null;
            notify();
          }
        }
      });
  }
  function retry() {
    const command = captured.current;
    if (
      !active() ||
      !command ||
      !live(command, command.action) ||
      !command.owner.uncertain ||
      pending.current ||
      action
    )
      return;
    const next = { ...command.action };
    command.action = next;
    decorate(command, next);
    setReview(command.review);
    setAction(next);
  }
  const frozen = !!captured.current || pending.current || uncertain;
  const command = captured.current;
  return (
    <div className="space-y-3 rounded-md border p-4" data-testid="saving-staff-address-form">
      <h3 className="font-semibold">{copy('staffAmendAddress')}</h3>
      <p className="text-sm text-muted-foreground">{copy('staffAmendAddressHelp')}</p>
      <Form {...form}>
        <form
          noValidate
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            prepare();
          }}
        >
          <FormField
            control={form.control}
            name="addressId"
            render={({ field }) => (
              <FormItem id="saving-amend-address">
                <FormLabel>{copy('stepAddress')}</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    disabled={frozen}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    {order.addressOptions.map((address) => (
                      <option key={address.id} value={address.id}>
                        {address.fullAddress} · {address.postalCode}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormDescription>{formCopy('staffAddressHelp')}</FormDescription>
                <FormMessage reserveSpace />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem id="saving-amend-reason">
                <FormLabel>{copy('staffAmendReason')}</FormLabel>
                <FormControl>
                  <Input {...field} disabled={frozen} />
                </FormControl>
                <FormDescription>{formCopy('staffReasonHelp')}</FormDescription>
                <FormMessage reserveSpace />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={frozen || busy || blocked()}
            aria-busy={busy || undefined}
          >
            {busy && (
              <span
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {copy('staffAmendAddress')}
          </Button>
          {busy && <p role="status">{formCopy('staffChecking')}</p>}
          {error && <p role="alert">{copy('staffReviewError')}</p>}
          {form.formState.errors.root?.validation && (
            <p role="alert">{formCopy('validationUnavailable')}</p>
          )}
        </form>
      </Form>
      {uncertain && (
        <div role="alert" className="space-y-2">
          <p>{formCopy('staffUncertain')}</p>
          <Button
            type="button"
            variant="outline"
            data-testid="saving-staff-address-retry"
            disabled={pending.current || !!action}
            onClick={retry}
          >
            {formCopy('staffRetryCaptured')}
          </Button>
        </div>
      )}
      {action && command && live(command, action) && (
        <TeamActionDialog
          action={action}
          summary={review ? <SavingAddressReviewSummary addressReview={review} /> : undefined}
          onClose={() => close(command, action)}
          onValidationError={() => false}
          onDenied={() => {
            if (live(command, action)) withdraw('forbidden');
          }}
          onUnconfirmed={() => unconfirmed(command, action)}
          onPendingChange={(value) => {
            if (!live(command, action)) return;
            pending.current = value;
            if (value) {
              command.owner.attempted = true;
              onPending();
              notify();
            }
          }}
          onSuccess={async (value) => {
            if (!live(command, action)) return;
            if (!matchedSavingAddressReceipt(value, command.review)) {
              unconfirmed(command, action);
              return;
            }
            privateWithdrawn.current = true;
            draftCache.current = null;
            form.reset({ addressId: command.review.data.replacementAddressId, reason: '' });
            release();
            onSuccess();
          }}
        />
      )}
    </div>
  );
}
