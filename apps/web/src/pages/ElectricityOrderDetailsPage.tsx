import { electricityCancellationText } from '@barghsa/i18n/electricity-cancellation-customer';
import {
  keepRecordFieldVisible,
  recordEditorFormSurface,
  StickyRecordEditorActions,
} from '../components/StickyRecordEditorActions.js';
import { RecordCommandGuard } from '../components/RecordCommandGuard.js';
import { RecordEditorActions, recordEditorSurface } from '../components/RecordEditorLayout.js';
import { ConfirmationFields } from '@barghsa/ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { toast } from '../lib/toast-api.js';
import { isInvoiceUuid } from '../lib/invoice-uuid.js';
import { useRiskConfirmation } from '../hooks/useRiskConfirmation.js';
import { useQueryClient } from '@tanstack/react-query';
import { useOwnedManualServerRead, useServerDetailQuery } from '../hooks/useServerQuery.js';
import { queryKeys } from '../lib/query-keys.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { OrderWalletBalance } from '../components/OrderWalletBalance.js';
import { historyContextText } from '../lib/history-context.js';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { t as increaseText } from '@barghsa/i18n/electricity-increase-customer';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { contractText } from '@barghsa/i18n/contracts';
import {
  LoadingStatus,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DualStatusDisplay,
  StatusTimeline,
  FinancialReviewSummary,
  Input,
  Textarea,
  buttonVariants,
} from '@barghsa/ui';
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
import { ErrorCodes } from '@barghsa/shared/errors';
import { ELECTRICITY_ORDER_STATUSES } from '@barghsa/shared/validation';
import {
  parseElectricityCancellationReview,
  type ElectricityCancellationReview,
} from '@barghsa/shared/finance';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  correctionRecord,
  correctionUuid,
  definitiveElectricityRejection,
  electricityCorrectionReceipt,
  type CorrectionOwner,
  type ElectricityCorrectionLock,
  type ElectricityAddressDraft,
} from '../lib/electricity-correction-form.js';
import { withCsrf } from '../lib/csrf.js';
import { ElectricityPriceAdjustmentsPanel } from './ElectricityPriceAdjustmentsPanel.js';
import { WorkflowStatusBanner } from '../components/WorkflowStatusBanner.js';
import { workflowFeedback } from '@barghsa/i18n/workflow-feedback';
import { OrderDiscussionSection } from '../components/OrderDiscussionSection.js';
import {
  commercialStatusTone,
  financialStatusTone,
  electricityStatusKey,
} from '../lib/electricity-status-tone.js';
import { electricityTimelineKey, electricityTimelineState } from '../lib/electricity-timeline.js';

const ElectricityOrderRevisionForm = lazy(() =>
  import('./ElectricityOrderRevisionForm.js').then((module) => ({
    default: module.ElectricityOrderRevisionForm,
  }))
);
const ContractActivationPanel = lazy(() =>
  import('../components/ContractActivationPanel.js').then((module) => ({
    default: module.ContractActivationPanel,
  }))
);
const ElectricityIncreasePanel = lazy(
  () => import('../components/ContractQuantityIncreasePanel.js')
);

interface ElectricityOrderDetail {
  orderId: string;
  profileId: string;
  profileName?: string;
  mode: string;
  submittedAt?: string | null;
  commercialStatus: string;
  electricityStatus: string;
  financialStatus: string;
  nextAction: string;
  periodStart: string;
  periodEnd: string;
  totalKwh: string;
  effectiveTotalKwh?: string;
  fullAddress: string;
  postalCode: string;
  provinceId: string;
  cityId: string;
  contractId: string;
  contractState: string;
  versionId: string;
  invoiceId: string;
  invoiceState: string;
  totalIrR: string;
  paidIrR: string;
  refundedIrR: string;
  giftCode?: string | null;
  pricingSnapshot?: {
    subtotalIrR?: string;
    discountIrR?: string;
    vatIrR?: string;
    requiredGreenKwh?: string;
    lines?: Array<{
      productId?: string;
      subtotalIrR?: string;
      discountIrR?: string;
      netIrR?: string;
      vatIrR?: string;
    }>;
  };
  greenRuleApplied?: boolean;
  giftDiscountIrR?: string;
  lines?: Array<{
    productId: string;
    systemKey: string | null;
    title: Record<string, string> | null;
    quantityKwh: string;
    unitPriceIrR: string;
    lineTotalIrR: string;
  }>;
  timeline?: Array<{
    id: string;
    event: string;
    at: string;
    actor: string | null;
    actorName?: string | null;
    actorContext?: string | null;
    reason: string | null;
    comment: string | null;
  }>;
  refundStatus?: string | null;
  refundReason?: string | null;
  financiallyClosed?: boolean;
}

function savedLineAmounts(
  snapshot: ElectricityOrderDetail['pricingSnapshot'],
  productId: string,
  storedSubtotal: string
) {
  const line = Array.isArray(snapshot?.lines)
    ? snapshot.lines.find((item) => item?.productId === productId)
    : undefined;
  if (
    !line ||
    line.subtotalIrR !== storedSubtotal ||
    typeof line.discountIrR !== 'string' ||
    !/^\d+$/.test(line.discountIrR) ||
    typeof line.netIrR !== 'string' ||
    !/^\d+$/.test(line.netIrR) ||
    typeof line.vatIrR !== 'string' ||
    !/^\d+$/.test(line.vatIrR)
  )
    return null;
  const discount = BigInt(line.discountIrR);
  const net = BigInt(line.netIrR);
  if (discount + net !== BigInt(storedSubtotal)) return null;
  return {
    discountIrR: line.discountIrR,
    vatIrR: line.vatIrR,
    payableIrR: (net + BigInt(line.vatIrR)).toString(),
  };
}

function cancellationPricingLines(snapshot: Record<string, unknown>) {
  return Array.isArray(snapshot.lines)
    ? snapshot.lines.filter(
        (
          line
        ): line is {
          systemKey: string;
          quantityKwh: string;
          unitPriceIrR: string;
          discountIrR: string;
          netIrR: string;
          vatIrR: string;
        } =>
          !!line &&
          typeof line === 'object' &&
          typeof line.systemKey === 'string' &&
          typeof line.quantityKwh === 'string' &&
          typeof line.unitPriceIrR === 'string' &&
          typeof line.discountIrR === 'string' &&
          typeof line.netIrR === 'string' &&
          typeof line.vatIrR === 'string'
      )
    : [];
}

const actionKeys: Record<string, string> = {
  await_review: 'electricity.order.nextAction.await_review',
  await_payment_review: 'electricity.order.nextAction.await_payment_review',
  resubmit_changes: 'electricity.order.nextAction.resubmit_changes',
  pay_invoice: 'electricity.order.nextAction.pay_invoice',
  accept_contract: 'electricity.order.nextAction.accept_contract',
  await_refund: 'electricity.order.nextAction.await_refund',
  await_delivery: 'electricity.order.nextAction.await_delivery',
  await_activation: 'electricity.order.nextAction.await_activation',
  continue_order: 'electricity.order.nextAction.continue_order',
  none: 'electricity.order.nextAction.none',
};
const refundKeys: Record<string, string> = {
  pending: 'electricity.order.refund.pending',
  processing: 'electricity.order.refund.processing',
  failed: 'electricity.order.refund.failed',
  completed: 'electricity.order.refund.completed',
};

function nextActionHref(detail: ElectricityOrderDetail, action: string): string | null {
  switch (action) {
    case 'pay_invoice':
    case 'await_payment_review':
    case 'await_refund':
      return `/invoices/${encodeURIComponent(detail.invoiceId)}`;
    case 'accept_contract':
      return `/contracts/${encodeURIComponent(detail.contractId)}`;
    case 'resubmit_changes':
      return detail.electricityStatus === 'changes_requested'
        ? `/electricity/orders/${encodeURIComponent(detail.orderId)}/edit`
        : null;
    case 'continue_order':
      return '/electricity/order';
    default:
      return null;
  }
}

function validOrderDetail(
  value: ElectricityOrderDetail | null,
  orderId: string
): value is ElectricityOrderDetail {
  return (
    !!value &&
    value.orderId === orderId &&
    correctionUuid(value.profileId) &&
    correctionUuid(value.versionId) &&
    correctionUuid(value.contractId) &&
    correctionUuid(value.invoiceId) &&
    [value.totalIrR, value.paidIrR, value.refundedIrR].every(
      (amount) => typeof amount === 'string' && /^\d+$/.test(amount)
    )
  );
}

function cancellable(detail: ElectricityOrderDetail) {
  return ['awaiting_staff_review', 'changes_requested'].includes(detail.electricityStatus);
}

export function ElectricityOrderDetailsPage({
  orderId,
  edit = false,
  cancel = false,
  onCorrectionComplete,
  onIncreaseRequestComplete,
}: {
  orderId: string;
  edit?: boolean;
  cancel?: boolean;
  onCorrectionComplete?: () => void;
  onIncreaseRequestComplete?: () => void;
}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const reader = useId();
  const client = useQueryClient();
  const scopeKey = JSON.stringify([actor, profileRevision, orderId]);
  const readReview = useOwnedManualServerRead(scopeKey);
  const readOwner = useRef({ scopeKey, epoch: 0 });
  if (readOwner.current.scopeKey !== scopeKey)
    readOwner.current = { scopeKey, epoch: readOwner.current.epoch + 1 };
  const scope = useRef(scopeKey);
  const generation = useRef(0);
  if (scope.current !== scopeKey) {
    scope.current = scopeKey;
    ++generation.current;
  }
  const [loadedDetail, setDetail] = useState<ElectricityOrderDetail | null>(null);
  const [acceptedScope, setAcceptedScope] = useState<string | null>(null);
  const detail = acceptedScope === scopeKey ? loadedDetail : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'unavailable' | 'load' | null>(null);
  const [retry, setRetry] = useState(0);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState(false);
  const [, renderLock] = useState(0);
  const cancellationActivity = useRef(false);
  const correctionLock = useMemo<ElectricityCorrectionLock>(() => {
    const lock: ElectricityCorrectionLock = {
      owner: null,
      acquire(owner: CorrectionOwner) {
        if (lock.owner || cancellationActivity.current) return false;
        lock.owner = owner;
        renderLock((value) => value + 1);
        return true;
      },
      release(owner: CorrectionOwner) {
        if (lock.owner !== owner) return;
        lock.owner = null;
        renderLock((value) => value + 1);
      },
    };
    return lock;
  }, [scopeKey]);
  const correctionMessages = {
    fullAddress: t('electricity.correctionForm.addressInvalid', locale),
    postalCode: t('electricity.correctionForm.postalInvalid', locale),
    responseNote: t('electricity.correctionForm.noteInvalid', locale),
  };
  const correctionForm = useZodForm<ElectricityAddressDraft>(
    async () => {
      const token = generation.current;
      const schemas = await import('../lib/electricity-correction-form-schemas.js');
      return token === generation.current
        ? schemas.electricityAddressSchema(correctionMessages)
        : schemas.inactiveElectricityCorrectionSchema;
    },
    {
      defaultValues: { fullAddress: '', postalCode: '', responseNote: '' },
      validationUnavailableMessage: t('electricity.correctionForm.validationUnavailable', locale),
    }
  );
  const correctionFieldErrors = useActionFieldErrors(
    correctionForm,
    correctionMessages,
    t('electricity.order.correction.error', locale)
  );
  const capturedCorrection = useRef<{
    body: string;
    snapshot: ElectricityOrderDetail;
    generation: number;
  } | null>(null);
  const correctionPending = useRef(false);
  const correctionTransport = useRef<AbortController | null>(null);
  const [unconfirmedCorrection, setUnconfirmedCorrection] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancelReasonId = useId();
  const [cancelKey, setCancelKey] = useState(() => crypto.randomUUID());
  const [cancelling, setCancelling] = useState(false);
  const [cancelReviewLoading, setCancelReviewLoading] = useState(false);
  const [cancelReview, setCancelReview] = useState<ElectricityCancellationReview | null>(null);
  const [cancelError, setCancelError] = useState<'stepup' | 'generic' | null>(null);
  const [cancelRecovery, setCancelRecovery] = useState<'check' | 'retry' | null>(null);
  const cancelTransport = useRef<AbortController | null>(null);
  cancellationActivity.current = cancelling || cancelReviewLoading || !!cancelReview;

  function withdraw() {
    ++generation.current;
    correctionTransport.current?.abort();
    cancelTransport.current?.abort();
    setDetail(null);
    setAcceptedScope(null);
    setError('unavailable');
    setLoading(false);
    capturedCorrection.current = null;
    setUnconfirmedCorrection(false);
    correctionPending.current = false;
    setSavingCorrection(false);
    setCancelling(false);
    setCancelReviewLoading(false);
    cancellationActivity.current = false;
    correctionLock.release('address');
    correctionLock.release('revision');
    correctionForm.reset({ fullAddress: '', postalCode: '', responseNote: '' });
    setCancelReview(null);
    setCancelReason('');
    setCancelRecovery(null);
  }
  function reloadDetail() {
    if (scope.current !== scopeKey || correctionLock.owner || capturedCorrection.current) return;
    correctionPending.current = false;
    setSavingCorrection(false);
    setCancelling(false);
    setCancelReviewLoading(false);
    setCancelReview(null);
    setCancelRecovery(null);
    cancellationActivity.current = false;
    ++generation.current;
    setDetail(null);
    setAcceptedScope(null);
    setLoading(true);
    setRetry((value) => value + 1);
  }

  function completeCorrection() {
    if (onCorrectionComplete) onCorrectionComplete();
    else reloadDetail();
  }

  useEffect(() => {
    capturedCorrection.current = null;
    correctionPending.current = false;
    setUnconfirmedCorrection(false);
    setSavingCorrection(false);
    setCorrectionError(false);
    correctionForm.reset({ fullAddress: '', postalCode: '', responseNote: '' });
    setCancelReview(null);
    setCancelReason('');
    setCancelKey(crypto.randomUUID());
    setCancelError(null);
    setCancelRecovery(null);
    setCancelling(false);
    setCancelReviewLoading(false);
    return () => {
      ++generation.current;
      correctionTransport.current?.abort();
      cancelTransport.current?.abort();
    };
  }, [scopeKey]);

  const queryKey = queryKeys.orders.detail(
    {
      context: 'account',
      ownerId: actor?.trim() ? actor : reader,
      accountId: actor,
      revision: profileRevision,
    },
    JSON.stringify([reader, orderId, readOwner.current.epoch, retry])
  );
  const query = useServerDetailQuery<{ status: number; value: ElectricityOrderDetail | null }>({
    queryKey,
    enabled: false,
    manual: true,
    read: async (signal) => {
      const response = await fetch(`/api/electricity/orders/${encodeURIComponent(orderId)}`, {
        credentials: 'include',
        signal,
      });
      if ([401, 403, 404].includes(response.status))
        return { status: response.status, value: null };
      if (!response.ok) throw new Error('Order unavailable');
      return { status: response.status, value: (await response.json()) as ElectricityOrderDetail };
    },
  });
  useEffect(() => {
    const controller = new AbortController();
    const token = generation.current;
    setLoading(true);
    setError(null);
    void query
      .refetch()
      .then((reply) => {
        if (controller.signal.aborted || token !== generation.current) return null;
        if (!reply.isSuccess || !reply.data) throw new Error('Order unavailable');
        if ([401, 403, 404].includes(reply.data.status)) {
          withdraw();
          return null;
        }
        return reply.data.value;
      })
      .then((value) => {
        if (controller.signal.aborted || token !== generation.current || !value) return;
        if (!validOrderDetail(value, orderId)) throw new Error('Invalid order detail');
        if (
          loadedDetail &&
          acceptedScope === scopeKey &&
          loadedDetail.profileId !== value.profileId
        ) {
          withdraw();
          return;
        }
        setDetail(value);
        setAcceptedScope(scopeKey);
        if (!capturedCorrection.current)
          correctionForm.reset({
            fullAddress: value.fullAddress,
            postalCode: value.postalCode,
            responseNote: '',
          });
      })
      .catch(() => {
        if (!controller.signal.aborted && token === generation.current) setError('load');
      })
      .finally(() => {
        if (!controller.signal.aborted && token === generation.current) setLoading(false);
      });
    return () => {
      controller.abort();
      void client.cancelQueries({ queryKey, exact: true });
    };
  }, [orderId, retry, scopeKey]);

  async function resubmitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (scope.current !== scopeKey) return;
    if (
      !detail ||
      detail.electricityStatus !== 'changes_requested' ||
      correctionPending.current ||
      capturedCorrection.current ||
      !correctionLock.acquire('address')
    )
      return;
    const token = generation.current;
    const raw = { ...correctionForm.getValues() };
    correctionPending.current = true;
    setSavingCorrection(true);
    setCorrectionError(false);
    try {
      await correctionForm.handleSubmit(async () => {
        if (
          token !== generation.current ||
          JSON.stringify(raw) !== JSON.stringify(correctionForm.getValues())
        )
          return;
        capturedCorrection.current = {
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            expectedVersionId: detail.versionId,
            fullAddress: raw.fullAddress.trim(),
            postalCode: raw.postalCode.trim(),
            responseNote: raw.responseNote.trim(),
          }),
          snapshot: detail,
          generation: token,
        };
        await sendCorrection(false);
      })();
    } catch {
      if (token === generation.current) setCorrectionError(true);
    } finally {
      if (token === generation.current) {
        correctionPending.current = false;
        setSavingCorrection(false);
        if (!capturedCorrection.current) correctionLock.release('address');
      }
    }
  }

  async function sendCorrection(retrying: boolean) {
    if (scope.current !== scopeKey) return;
    const attempt = capturedCorrection.current;
    if (!attempt || attempt.generation !== generation.current) return;
    const transport = new AbortController();
    correctionTransport.current = transport;
    try {
      const { response, value } = await readWithDeadline(transport.signal, async (signal) => {
        const response = await fetch(
          `/api/electricity/orders/${encodeURIComponent(orderId)}/resubmit-address`,
          {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: attempt.body,
            signal,
          }
        );
        return { response, value: (await response.json().catch(() => null)) as unknown };
      });
      if (attempt !== capturedCorrection.current || attempt.generation !== generation.current)
        return;
      if ([401, 403, 404].includes(response.status)) {
        withdraw();
        return;
      }
      if (!response.ok) {
        if (
          !retrying &&
          response.status >= 400 &&
          response.status < 500 &&
          definitiveElectricityRejection(value)
        ) {
          capturedCorrection.current = null;
          setUnconfirmedCorrection(false);
          if (
            response.status === 400 &&
            correctionRecord(value) &&
            correctionRecord(value.error) &&
            value.error.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
            Array.isArray(value.error.fields) &&
            correctionFieldErrors(value.error.fields)
          )
            return;
          setCorrectionError(true);
          return;
        }
        throw new Error('Correction unconfirmed');
      }
      if (!electricityCorrectionReceipt(value, attempt.snapshot))
        throw new Error('Correction unconfirmed');
      capturedCorrection.current = null;
      setUnconfirmedCorrection(false);
      correctionLock.release('address');
      correctionForm.reset({ ...correctionForm.getValues(), responseNote: '' });
      toast.success(confirmationText('recorded', locale));
      completeCorrection();
    } catch {
      if (attempt === capturedCorrection.current && attempt.generation === generation.current) {
        setUnconfirmedCorrection(true);
        setCorrectionError(true);
      }
    } finally {
      if (correctionTransport.current === transport) correctionTransport.current = null;
    }
  }

  async function retryCorrection() {
    if (scope.current !== scopeKey) return;
    if (
      correctionPending.current ||
      correctionLock.owner !== 'address' ||
      !capturedCorrection.current
    )
      return;
    const token = generation.current;
    correctionPending.current = true;
    setSavingCorrection(true);
    setCorrectionError(false);
    try {
      await sendCorrection(true);
    } finally {
      if (token === generation.current) {
        correctionPending.current = false;
        setSavingCorrection(false);
      }
    }
  }

  async function cancelOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !detail ||
      !cancellable(detail) ||
      correctionLock.owner ||
      cancellationActivity.current ||
      !cancelReason.trim()
    )
      return;
    const token = generation.current;
    const reason = cancelReason.trim();
    cancellationActivity.current = true;
    setCancelReviewLoading(true);
    setCancelError(null);
    try {
      const review = await readReview(
        queryKeys.orders.detail(
          {
            context: 'customer',
            ownerId: detail.profileId,
            accountId: actor,
            revision: profileRevision,
          },
          JSON.stringify([orderId, 'cancel-review'])
        ),
        undefined,
        async (signal) => {
          const response = await fetch(
            `/api/electricity/orders/${encodeURIComponent(orderId)}/cancel-review`,
            {
              method: 'POST',
              credentials: 'include',
              signal,
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ reason }),
            }
          );
          if (!response.ok) throw new Error('Review failed');
          return parseElectricityCancellationReview(await response.json());
        }
      );
      if (token !== generation.current) return;
      if (
        !review ||
        review.scope.profileId !== detail.profileId ||
        review.scope.resourceId !== orderId ||
        review.data.versionId !== detail.versionId ||
        review.data.reason !== reason
      )
        throw new Error('Review mismatch');
      setCancelReview(review);
    } catch {
      if (token === generation.current) setCancelError('generic');
    } finally {
      if (token === generation.current) {
        cancellationActivity.current = false;
        setCancelReviewLoading(false);
      }
    }
  }

  const cancelFocus = useRef<HTMLButtonElement>(null);
  const cancellationIntent = useMemo(
    () => ({ cancelReview, cancelRecovery }),
    [cancelReview, cancelRecovery]
  );
  const financialGate = useRiskConfirmation(cancellationIntent, locale, 'both');

  async function checkCancellation() {
    if (scope.current !== scopeKey || !cancelReview || !cancelRecovery || cancelTransport.current)
      return;
    const controller = new AbortController();
    cancelTransport.current = controller;
    const token = generation.current;
    setCancelRecovery('check');
    setCancelling(true);
    try {
      const reply = await query.refetch();
      if (controller.signal.aborted || token !== generation.current) return;
      if (!reply.isSuccess || !reply.data) return;
      const { status, value } = reply.data;
      if ([401, 403, 404].includes(status)) {
        withdraw();
        return;
      }
      if (
        !validOrderDetail(value, orderId) ||
        !ELECTRICITY_ORDER_STATUSES.some((status) => status === value.electricityStatus)
      )
        return;
      if (value.profileId !== cancelReview.scope.profileId) {
        withdraw();
        return;
      }
      if (value.versionId === cancelReview.data.versionId && cancellable(value)) {
        setCancelRecovery('retry');
        return;
      }
      setCancelReview(null);
      setCancelRecovery(null);
      setCancelError(null);
      setCancelKey(crypto.randomUUID());
      setDetail(value);
      correctionForm.reset({
        fullAddress: value.fullAddress,
        postalCode: value.postalCode,
        responseNote: '',
      });
    } finally {
      if (cancelTransport.current === controller) cancelTransport.current = null;
      if (token === generation.current) setCancelling(false);
    }
  }

  async function confirmCancellation() {
    if (
      scope.current !== scopeKey ||
      !financialGate.allowed ||
      !cancelReview ||
      !detail ||
      !cancellable(detail) ||
      cancelReview.scope.profileId !== detail.profileId ||
      cancelReview.data.versionId !== detail.versionId ||
      correctionLock.owner ||
      cancelTransport.current ||
      cancelRecovery === 'check' ||
      cancelReview.scope.resourceId !== orderId
    )
      return;
    const token = generation.current;
    const controller = new AbortController();
    cancelTransport.current = controller;
    cancellationActivity.current = true;
    setCancelling(true);
    setCancelError(null);
    try {
      const { response, receipt } = await readWithDeadline(controller.signal, async (signal) => {
        const response = await fetch(
          `/api/electricity/orders/${encodeURIComponent(orderId)}/cancel`,
          {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              idempotencyKey: cancelKey,
              expectedVersionId: cancelReview.data.versionId,
              expectedReviewHash: cancelReview.hash,
              reason: cancelReview.data.reason,
            }),
            signal,
          }
        );
        const receipt: unknown = response.ok ? await response.json().catch(() => null) : null;
        return { response, receipt };
      });
      if (token !== generation.current) return;
      if ([401, 404].includes(response.status)) {
        withdraw();
        return;
      }
      if (response.status === 403) {
        setCancelError('stepup');
        if (cancelRecovery) setCancelRecovery('check');
        else setCancelReview(null);
        return;
      }
      if (!cancelRecovery && response.status >= 400 && response.status < 500) {
        setCancelError('generic');
        reloadDetail();
        return;
      }
      if (!response.ok) throw new Error('Cancellation failed');
      if (
        response.status !== 200 ||
        !correctionRecord(receipt) ||
        receipt.orderId !== orderId ||
        receipt.status !== 'cancelled' ||
        (cancelReview.data.refundAmount === '0'
          ? receipt.refundId !== null
          : typeof receipt.refundId !== 'string' || !isInvoiceUuid(receipt.refundId))
      )
        throw new Error('Cancellation receipt mismatch');
      toast.success(confirmationText('recorded', locale));
      setCancelReview(null);
      setCancelKey(crypto.randomUUID());
      reloadDetail();
    } catch {
      if (token !== generation.current) return;
      setCancelRecovery('check');
    } finally {
      if (cancelTransport.current === controller) cancelTransport.current = null;
      if (token === generation.current) {
        setCancelling(false);
      }
    }
  }

  const nextAction =
    detail?.electricityStatus === 'changes_requested' ? 'resubmit_changes' : detail?.nextAction;
  const nextActionLink =
    detail && nextAction && !(nextAction === 'resubmit_changes' && cancellationActivity.current)
      ? nextActionHref(detail, nextAction)
      : null;
  const latestEvent = detail?.timeline?.at(-1);
  const requestedChange = edit
    ? detail?.timeline
        ?.filter((event) => event.event === 'electricity.order_review.request-changes')
        .at(-1)?.reason
    : null;
  const terminalOrder =
    detail !== null && ['rejected', 'cancelled'].includes(detail.electricityStatus);
  const canOpenContract =
    detail !== null &&
    [
      'AwaitingCustomerAcceptance',
      'Accepted',
      'AwaitingSignature',
      'Signed',
      'Active',
      'Completed',
    ].includes(detail.contractState);
  const refundRemaining = detail ? BigInt(detail.paidIrR) - BigInt(detail.refundedIrR) : 0n;
  const actionOwner =
    nextAction === 'none'
      ? 'none'
      : ['pay_invoice', 'accept_contract', 'resubmit_changes', 'continue_order'].includes(
            nextAction ?? ''
          )
        ? 'customer'
        : 'staff';
  const increaseRoute = onIncreaseRequestComplete !== undefined;
  const showingIncreaseForm =
    increaseRoute && !loading && !error && detail?.contractState === 'Active';
  const orderActionPage = edit || increaseRoute || cancel;
  const cancellationLocked = () => cancelTransport.current !== null || cancelRecovery !== null;
  return (
    <div
      className={`mx-auto w-full max-w-2xl min-w-0 ${orderActionPage ? 'space-y-4' : 'space-y-6 px-4 py-8'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {edit && <RecordCommandGuard blocked={() => !!correctionLock.owner} />}
      {cancel && <RecordCommandGuard blocked={cancellationLocked} />}
      {!showingIncreaseForm && (
        <header data-toast-anchor className="space-y-2">
          {orderActionPage ? (
            <Link
              to="/electricity/orders/$orderId"
              params={{ orderId }}
              disabled={!!correctionLock.owner || (cancel && cancellationLocked())}
              className="touch-action text-sm text-primary underline underline-offset-4 aria-disabled:opacity-60"
            >
              {cancel
                ? electricityCancellationText('cancelBackToOrder', locale)
                : t('electricity.order.detail.title', locale)}
            </Link>
          ) : (
            <Link
              to="/electricity/orders"
              className="touch-action text-sm text-primary underline underline-offset-4"
            >
              {t('electricity.order.detail.back', locale)}
            </Link>
          )}
          <h1 className="text-2xl font-bold">
            {increaseRoute
              ? increaseText('electricity.increase.title', locale)
              : t(
                  cancel
                    ? 'electricity.order.detail.cancel'
                    : edit
                      ? 'electricity.order.correction.title'
                      : 'electricity.order.detail.title',
                  locale
                )}
          </h1>
          {!orderActionPage && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-muted-foreground">
                {t('electricity.order.detail.description', locale)}
              </p>
              {!loading && !error && detail && cancellable(detail) && (
                <Link
                  to="/electricity/orders/$orderId/cancel"
                  params={{ orderId }}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  {t('electricity.order.detail.cancel', locale)}
                </Link>
              )}
            </div>
          )}
        </header>
      )}
      {time.notice}
      {loading ? (
        <LoadingStatus>{t('electricity.order.detailLoading', locale)}</LoadingStatus>
      ) : error === 'unavailable' ? (
        <p role="alert">{loadingText('recordUnavailable', locale)}</p>
      ) : error || !detail ? (
        <div role="alert" className="space-y-3">
          <p>{t('electricity.order.detailFailed', locale)}</p>
          <Button onClick={() => reloadDetail()}>{t('electricity.order.retry', locale)}</Button>
        </div>
      ) : cancel ? (
        cancellable(detail) ? (
          <form
            className={recordEditorSurface}
            onSubmit={cancelOrder}
            aria-busy={cancelReviewLoading}
          >
            <div className="space-y-4 px-4 py-4 sm:px-6">
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 rounded-lg bg-muted/45 p-3 text-sm">
                <div className="min-w-0">
                  <dt className="text-muted-foreground">
                    {electricityCancellationText('cancelReviewProfile', locale)}
                  </dt>
                  <dd className="wrap-anywhere font-medium" dir="auto">
                    {detail.profileName || detail.profileId}
                  </dd>
                </div>
                <div className="text-end">
                  <dt className="text-muted-foreground">
                    {t('electricity.order.quantity', locale)}
                  </dt>
                  <dd className="font-medium">
                    <bdi>{detail.totalKwh} kWh</bdi>
                  </dd>
                </div>
                <div className="col-span-full min-w-0 border-t border-border/65 pt-2">
                  <dt className="text-muted-foreground">
                    {electricityCancellationText('cancelReviewPeriod', locale)}
                  </dt>
                  <dd className="font-medium">
                    {time.format(detail.periodStart, {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    })}
                    {' – '}
                    {time.format(new Date(new Date(detail.periodEnd).getTime() - 1), {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </dd>
                </div>
              </dl>
              <div className="space-y-1.5">
                <label htmlFor={cancelReasonId} className="block text-sm font-medium">
                  {t('electricity.order.detail.cancelReason', locale)}
                </label>
                <p id={`${cancelReasonId}-hint`} className="text-sm text-muted-foreground">
                  {electricityCancellationText('cancelReasonHint', locale)}
                </p>
                <Textarea
                  id={cancelReasonId}
                  className="min-h-0"
                  rows={2}
                  dir="auto"
                  required
                  aria-required="true"
                  aria-describedby={`${cancelReasonId}-hint`}
                  maxLength={1000}
                  value={cancelReason}
                  readOnly={cancelReviewLoading || !!cancelReview}
                  onChange={(event) => setCancelReason(event.target.value)}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {electricityCancellationText('cancelPreviewHint', locale)}
              </p>
              {cancelError ? (
                <p role="alert" className="text-sm text-destructive">
                  {electricityCancellationText(
                    cancelError === 'stepup' ? 'cancelStepUp' : 'cancelFailed',
                    locale
                  )}
                  {cancelError === 'stepup' ? (
                    <Link to="/settings/security" className="ms-2 underline">
                      {t('electricity.order.detail.security', locale)}
                    </Link>
                  ) : null}
                </p>
              ) : null}
            </div>
            <RecordEditorActions>
              <Button
                type="submit"
                disabled={
                  cancelling || cancelReviewLoading || !!cancelReview || !cancelReason.trim()
                }
              >
                {electricityCancellationText(
                  cancelReviewLoading ? 'cancelReviewLoading' : 'cancelReviewAction',
                  locale
                )}
              </Button>
            </RecordEditorActions>
          </form>
        ) : (
          <p role="status" className="rounded-lg border bg-card px-4 py-3 text-sm">
            {detail.electricityStatus === 'cancelled'
              ? t('electricity.order.status.cancelled', locale)
              : electricityCancellationText('cancelUnavailable', locale)}
          </p>
        )
      ) : onIncreaseRequestComplete ? (
        detail.contractState === 'Active' ? (
          <Suspense
            fallback={
              <LoadingStatus>{increaseText('electricity.increase.loading', locale)}</LoadingStatus>
            }
          >
            <ElectricityIncreasePanel
              contractId={detail.contractId}
              profileId={detail.profileId}
              versionId={detail.versionId}
              formatTimestamp={time.format}
              onRequestComplete={onIncreaseRequestComplete}
              requestNavigation={(blocked, disabled) => (
                <>
                  <RecordCommandGuard blocked={blocked} />
                  <Link
                    to="/electricity/orders/$orderId"
                    params={{ orderId }}
                    disabled={disabled}
                    className="touch-action text-sm text-primary underline underline-offset-4 aria-disabled:opacity-60"
                  >
                    {increaseText('electricity.increaseForm.backToOrder', locale)}
                  </Link>
                </>
              )}
            />
          </Suspense>
        ) : (
          <p role="status">{increaseText('electricity.increaseForm.requestUnavailable', locale)}</p>
        )
      ) : edit ? (
        detail.electricityStatus === 'changes_requested' ? (
          <>
            {typeof requestedChange === 'string' && requestedChange.trim() && (
              <section className="space-y-1.5 rounded-lg border border-warning/25 bg-warning-soft px-4 py-3">
                <h2 className="text-sm font-semibold">
                  {t('electricity.order.timeline.changes', locale)}
                </h2>
                <p className="whitespace-pre-wrap wrap-anywhere text-sm" dir="auto">
                  {requestedChange}
                </p>
              </section>
            )}
            <p className="text-sm">
              <a
                href="#electricity-order-revision"
                className="touch-action text-primary underline underline-offset-4"
              >
                {t('electricity.order.revision.title', locale)}
              </a>
            </p>
            <section id="electricity-order-correction" className="min-w-0 space-y-3">
              <Form {...correctionForm}>
                <form
                  noValidate
                  data-testid="electricity-address-correction-form"
                  className={recordEditorFormSurface}
                  onFocus={keepRecordFieldVisible}
                  onSubmit={(event) => void resubmitCorrection(event)}
                >
                  <div className="space-y-1 border-b bg-muted/25 px-4 py-3 sm:px-5">
                    <h2 className="text-base font-semibold">
                      {t('electricity.correctionForm.addressOnly', locale)}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {t('electricity.order.correction.description', locale)}
                    </p>
                  </div>
                  <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,2fr)_minmax(10rem,1fr)] sm:px-5">
                    {(['fullAddress', 'postalCode', 'responseNote'] as const).map((name) => (
                      <FormField
                        key={name}
                        control={correctionForm.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem
                            className={name === 'responseNote' ? 'sm:col-span-2' : undefined}
                            id={
                              name === 'fullAddress'
                                ? 'correction-address'
                                : name === 'postalCode'
                                  ? 'correction-postal'
                                  : 'correction-note'
                            }
                          >
                            <FormLabel>
                              {t(
                                name === 'fullAddress'
                                  ? 'electricity.order.deliveryAddress'
                                  : name === 'postalCode'
                                    ? 'electricity.order.correction.postalCode'
                                    : 'electricity.order.correction.responseNote',
                                locale
                              )}
                            </FormLabel>
                            <FormControl>
                              {name === 'responseNote' ? (
                                <Textarea
                                  {...field}
                                  aria-required="true"
                                  rows={2}
                                  dir="auto"
                                  className="max-h-36 min-h-14"
                                  maxLength={1000}
                                  disabled={!!correctionLock.owner}
                                />
                              ) : (
                                <Input
                                  {...field}
                                  aria-required="true"
                                  maxLength={name === 'fullAddress' ? 500 : 10}
                                  inputMode={name === 'postalCode' ? 'numeric' : 'text'}
                                  dir={name === 'postalCode' ? 'ltr' : 'auto'}
                                  disabled={!!correctionLock.owner}
                                />
                              )}
                            </FormControl>
                            <FormDescription
                              className={name === 'fullAddress' ? 'sr-only' : undefined}
                            >
                              {t(
                                name === 'postalCode'
                                  ? 'electricity.correctionForm.postalInvalid'
                                  : name === 'responseNote'
                                    ? 'electricity.correctionForm.responseHelp'
                                    : 'electricity.correctionForm.help',
                                locale
                              )}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                    {correctionError || correctionForm.formState.errors.root ? (
                      <p role="alert" className="text-sm text-destructive sm:col-span-2">
                        {unconfirmedCorrection
                          ? t('electricity.correctionForm.uncertain', locale)
                          : (correctionForm.formState.errors.root?.validation?.message ??
                            t('electricity.order.correction.error', locale))}
                      </p>
                    ) : null}
                    {correctionLock.owner === 'revision' ? (
                      <p role="status" className="sm:col-span-2">
                        {t('electricity.correctionForm.busy', locale)}
                      </p>
                    ) : null}
                  </div>
                  <StickyRecordEditorActions>
                    <Button
                      type="submit"
                      loading={savingCorrection}
                      disabled={!!correctionLock.owner}
                    >
                      {t('electricity.order.correction.submit', locale)}
                    </Button>
                    {unconfirmedCorrection ? (
                      <Button
                        type="button"
                        data-testid="electricity-address-correction-retry"
                        variant="outline"
                        disabled={savingCorrection}
                        onClick={() => void retryCorrection()}
                      >
                        {t('electricity.correctionForm.retry', locale)}
                      </Button>
                    ) : null}
                  </StickyRecordEditorActions>
                </form>
              </Form>
              <div
                id="electricity-order-revision"
                tabIndex={-1}
                className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Suspense
                  fallback={
                    <LoadingStatus>
                      {t('electricity.correctionForm.loadingRevision', locale)}
                    </LoadingStatus>
                  }
                >
                  <ElectricityOrderRevisionForm
                    key={JSON.stringify([scopeKey, detail.profileId, detail.versionId])}
                    order={detail}
                    onComplete={completeCorrection}
                    coordination={correctionLock}
                    onDenied={withdraw}
                  />
                </Suspense>
              </div>
            </section>
          </>
        ) : (
          <p role="status">{t('electricity.correctionForm.noLongerEditable', locale)}</p>
        )
      ) : (
        <>
          <WorkflowStatusBanner
            locale={locale}
            submittedAt={
              detail.submittedAt
                ? `${workflowFeedback('submitted', locale)}: ${time.format(detail.submittedAt)}`
                : undefined
            }
            status={t(electricityStatusKey(detail.electricityStatus, 'commercial'), locale)}
            happened={t(
              latestEvent
                ? electricityTimelineKey(latestEvent.event)
                : electricityStatusKey(detail.electricityStatus, 'commercial'),
              locale
            )}
            nextAction={t(
              actionKeys[nextAction ?? ''] ?? 'electricity.order.nextAction.none',
              locale
            )}
            owner={actionOwner}
            actionHref={nextActionLink}
          />
          <DualStatusDisplay
            commercialLabel={t('electricity.order.commercialStatus', locale)}
            commercialStatus={t(
              electricityStatusKey(detail.electricityStatus, 'commercial'),
              locale
            )}
            commercialTone={commercialStatusTone(detail.electricityStatus)}
            financialLabel={t('electricity.order.financialStatus', locale)}
            financialStatus={t(electricityStatusKey(detail.financialStatus, 'financial'), locale)}
            financialTone={financialStatusTone(detail.financialStatus)}
          />
          <Card>
            <CardContent className="space-y-3 pt-6 text-sm">
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.success.order', locale)}</span>
                <strong className="break-all">{detail.orderId}</strong>
              </p>
              {['simple', 'advanced'].includes(detail.mode) ? (
                <p className="flex justify-between gap-3">
                  <span>{t('electricity.order.detail.mode', locale)}</span>
                  <span>
                    {t(
                      detail.mode === 'advanced'
                        ? 'electricity.order.detail.mode.advanced'
                        : 'electricity.order.detail.mode.simple',
                      locale
                    )}
                  </span>
                </p>
              ) : null}
              {detail.submittedAt ? (
                <p className="flex justify-between gap-3">
                  <span>{t('electricity.order.detail.submittedAt', locale)}</span>
                  <time dateTime={detail.submittedAt}>{time.format(detail.submittedAt)}</time>
                </p>
              ) : null}
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.profile', locale)}</span>
                <span>{detail.profileName || detail.profileId}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.contractStatus', locale)}</span>
                <span>{contractText(detail.contractState, locale)}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.period.selection', locale)}</span>
                <span>
                  {time.format(detail.periodStart, {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  })}{' '}
                  –{' '}
                  {time.format(new Date(new Date(detail.periodEnd).getTime() - 1), {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  })}
                </span>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.quantity', locale)}</span>
                <span>{detail.totalKwh} kWh</span>
              </p>
              {detail.effectiveTotalKwh && detail.effectiveTotalKwh !== detail.totalKwh ? (
                <p className="flex justify-between gap-3 font-medium">
                  <span>{t('electricity.increase.currentQuantity', locale)}</span>
                  <span>{numbers.irrDigits(detail.effectiveTotalKwh)} kWh</span>
                </p>
              ) : null}
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.total', locale)}</span>
                <strong>{numbers.money(detail.totalIrR)}</strong>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.paidAmount', locale)}</span>
                <span>{numbers.money(detail.paidIrR)}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.refundedAmount', locale)}</span>
                <span>{numbers.money(detail.refundedIrR)}</span>
              </p>
              {terminalOrder ? (
                refundRemaining > 0n ? (
                  <p className="flex justify-between gap-3">
                    <span>{t('electricity.order.refundRemainingAmount', locale)}</span>
                    <span>{numbers.money(refundRemaining.toString())}</span>
                  </p>
                ) : null
              ) : (
                <p className="flex justify-between gap-3">
                  <span>{t('electricity.order.remainingAmount', locale)}</span>
                  <span>
                    {numbers.money((BigInt(detail.totalIrR) - BigInt(detail.paidIrR)).toString())}
                  </span>
                </p>
              )}
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.deliveryAddress', locale)}</span>
                <span>{detail.fullAddress}</span>
              </p>
              {detail.postalCode ? (
                <p className="flex justify-between gap-3">
                  <span>{t('electricity.order.postalCode', locale)}</span>
                  <span dir="ltr">{detail.postalCode}</span>
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 pt-6 text-sm">
              <h2 className="font-semibold">{t('electricity.order.detail.lines', locale)}</h2>
              {detail.lines?.map((line) => {
                const amounts = savedLineAmounts(
                  detail.pricingSnapshot,
                  line.productId,
                  line.lineTotalIrR
                );
                return (
                  <div
                    key={line.productId}
                    className="flex flex-wrap items-start justify-between gap-2 border-t pt-2"
                  >
                    <span>
                      {line.title?.[locale] ?? line.title?.en ?? line.systemKey} ·{' '}
                      {numbers.irrDigits(line.quantityKwh)} kWh
                    </span>
                    <span className="text-end">
                      <span className="block">
                        {t('electricity.order.detail.unitPrice', locale)}{' '}
                        {numbers.money(line.unitPriceIrR)}
                      </span>
                      <span className="block">
                        {t('electricity.order.detail.subtotal', locale)}:{' '}
                        {numbers.money(line.lineTotalIrR)}
                      </span>
                      {amounts ? (
                        <>
                          <span className="block">
                            {t('electricity.order.discount', locale)}:{' '}
                            {numbers.money(amounts.discountIrR)}
                          </span>
                          <span className="block">
                            {t('electricity.order.vat', locale)}: {numbers.money(amounts.vatIrR)}
                          </span>
                          <strong className="block">
                            {t('electricity.order.lineTotal', locale)}:{' '}
                            {numbers.money(amounts.payableIrR)}
                          </strong>
                        </>
                      ) : null}
                    </span>
                  </div>
                );
              })}
              {detail.greenRuleApplied ? (
                <p>{t('electricity.order.detail.greenRule', locale)}</p>
              ) : null}
              {detail.pricingSnapshot?.requiredGreenKwh &&
              BigInt(detail.pricingSnapshot.requiredGreenKwh) > 0n ? (
                <p>
                  {t('electricity.order.detail.greenKwh', locale)}:{' '}
                  {numbers.irrDigits(detail.pricingSnapshot.requiredGreenKwh)} kWh
                </p>
              ) : null}
              {detail.pricingSnapshot?.subtotalIrR ? (
                <p>
                  {t('electricity.order.detail.subtotal', locale)}:{' '}
                  {numbers.money(detail.pricingSnapshot.subtotalIrR)}
                </p>
              ) : null}
              {detail.giftDiscountIrR && BigInt(detail.giftDiscountIrR) > 0n ? (
                <p>
                  {t('electricity.order.detail.giftDiscount', locale)}
                  {detail.giftCode ? ` (${detail.giftCode})` : ''}:{' '}
                  {numbers.money(detail.giftDiscountIrR)}
                </p>
              ) : null}
              {detail.pricingSnapshot?.vatIrR ? (
                <p>
                  {t('electricity.order.vat', locale)}:{' '}
                  {numbers.money(detail.pricingSnapshot.vatIrR)}
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 pt-6">
              <h2 className="font-semibold">{t('electricity.order.documentsTitle', locale)}</h2>
              <p className="text-sm text-muted-foreground">
                {t(
                  canOpenContract
                    ? 'electricity.order.documentsNotice'
                    : 'electricity.order.documentsPending',
                  locale
                )}
              </p>
              {canOpenContract && (
                <Suspense fallback={<p role="status">{contractText('loading', locale)}</p>}>
                  <ContractActivationPanel
                    key={JSON.stringify([detail.profileId, detail.contractId, detail.versionId])}
                    id={detail.contractId}
                    versionId={detail.versionId}
                    staff={false}
                  />
                </Suspense>
              )}
            </CardContent>
          </Card>
          <OrderWalletBalance
            profileId={detail.profileId}
            scopeKey={JSON.stringify([scopeKey, detail.orderId, detail.versionId])}
          />
          {detail.contractState === 'Active' ? (
            <Suspense
              fallback={
                <LoadingStatus>
                  {increaseText('electricity.increase.loading', locale)}
                </LoadingStatus>
              }
            >
              <ElectricityIncreasePanel
                contractId={detail.contractId}
                profileId={detail.profileId}
                versionId={detail.versionId}
                formatTimestamp={time.format}
                requestAction={
                  <Link
                    to="/electricity/orders/$orderId/increases/new"
                    params={{ orderId }}
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    {increaseText('electricity.increaseForm.openRequest', locale)}
                  </Link>
                }
              />
            </Suspense>
          ) : null}
          <ElectricityPriceAdjustmentsPanel
            contractId={detail.contractId}
            profileId={detail.profileId}
            versionId={detail.versionId}
            formatTimestamp={time.format}
          />
          <Card>
            <CardContent className="pt-6">
              <OrderDiscussionSection
                kind="electricity"
                orderId={orderId}
                profileId={detail.profileId}
                sourceVersion={detail.versionId}
                formatTimestamp={time.format}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 pt-6 text-sm">
              <h2 className="font-semibold">{t('electricity.order.detail.timeline', locale)}</h2>
              {detail.timeline?.length ? (
                <StatusTimeline
                  label={t('electricity.order.detail.timeline', locale)}
                  items={detail.timeline.map((event) => ({
                    id: event.id,
                    title: t(electricityTimelineKey(event.event), locale),
                    state: electricityTimelineState(event.event),
                    dateTime: event.at,
                    dateLabel: time.format(event.at),
                    actorLabel: [event.actorName, historyContextText(event.actorContext, locale)]
                      .filter(Boolean)
                      .join(' · '),
                    description: [event.reason, event.comment].filter(Boolean).join(' · '),
                  }))}
                />
              ) : (
                <p>{t('electricity.order.detail.noTimeline', locale)}</p>
              )}
              {detail.refundStatus ? (
                <p>
                  {t('electricity.order.detail.refund', locale)}:{' '}
                  {t(refundKeys[detail.refundStatus] ?? 'electricity.order.refund.pending', locale)}{' '}
                  · {detail.refundReason}
                </p>
              ) : null}
              {terminalOrder ? (
                <p>
                  {t(
                    detail.financiallyClosed
                      ? detail.paidIrR === '0'
                        ? 'electricity.order.detail.noRefundRequired'
                        : 'electricity.order.detail.financiallyClosed'
                      : 'electricity.order.detail.refundPending',
                    locale
                  )}
                </p>
              ) : null}
              <Link
                to="/tickets/new"
                search={{ relatedType: 'order', relatedId: detail.orderId }}
                className="touch-action text-primary underline underline-offset-4"
              >
                {t('electricity.order.detail.help', locale)}
              </Link>
            </CardContent>
          </Card>
          <div className="flex flex-wrap gap-3">
            {canOpenContract ? (
              <Link
                to="/contracts/$contractId/{-$action}"
                params={{ contractId: detail.contractId }}
                className="touch-action max-w-full rounded-md border px-4 py-2 text-sm text-primary underline underline-offset-4 [overflow-wrap:anywhere]"
              >
                {t('electricity.order.success.contract', locale)}: <bdi>{detail.contractId}</bdi>
              </Link>
            ) : (
              <span className="max-w-full rounded-md border px-4 py-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {t('electricity.order.contractPending', locale)}: <bdi>{detail.contractId}</bdi>
              </span>
            )}
            <Link
              to="/invoices/$invoiceId"
              params={{ invoiceId: detail.invoiceId }}
              className="touch-action max-w-full rounded-md border px-4 py-2 text-sm text-primary underline underline-offset-4 [overflow-wrap:anywhere]"
            >
              {t('electricity.order.financialReviewLink', locale)}: <bdi>{detail.invoiceId}</bdi>
            </Link>
          </div>
          {!['rejected', 'cancelled', 'changes_requested'].includes(detail.electricityStatus) &&
          ['unpaid', 'partially_funded', 'payment_under_review'].includes(
            detail.financialStatus
          ) ? (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>{t('electricity.order.paymentOptions', locale)}</p>
              <p>{t('electricity.order.paymentAfterSubmit', locale)}</p>
            </div>
          ) : null}
        </>
      )}
      {detail &&
      cancelReview &&
      cancelReview.scope.resourceId === orderId &&
      cancelReview.scope.profileId === detail.profileId &&
      cancelReview.data.versionId === detail.versionId ? (
        <Dialog
          open
          onOpenChange={(open) => !open && !cancelling && !cancelRecovery && setCancelReview(null)}
        >
          <DialogContent
            className="max-h-[90dvh] overflow-y-auto"
            dir={locale === 'fa' ? 'rtl' : 'ltr'}
            showCloseButton={!cancelling && !cancelRecovery}
            aria-busy={cancelling}
            initialFocus={cancelFocus}
          >
            <DialogHeader>
              <DialogTitle>{electricityCancellationText('cancelReviewTitle', locale)}</DialogTitle>
              <DialogDescription>
                {electricityCancellationText('cancelConfirm', locale)}
              </DialogDescription>
            </DialogHeader>
            <FinancialReviewSummary
              title={electricityCancellationText('cancelReviewTitle', locale)}
              rows={[
                {
                  id: 'profile',
                  label: electricityCancellationText('cancelReviewProfile', locale),
                  value: cancelReview.data.profileName,
                },
                {
                  id: 'period',
                  label: electricityCancellationText('cancelReviewPeriod', locale),
                  value: `${time.format(cancelReview.data.periodStart, { year: 'numeric', month: '2-digit', day: '2-digit' })} – ${time.format(new Date(new Date(cancelReview.data.periodEnd).getTime() - 1), { year: 'numeric', month: '2-digit', day: '2-digit' })}`,
                },
                {
                  id: 'quantity',
                  label: t('electricity.order.quantity', locale),
                  value: `${cancelReview.data.totalKwh} kWh`,
                },
                ...cancellationPricingLines(cancelReview.data.pricingSnapshot).map(
                  (line, index) => ({
                    id: `line-${index}`,
                    label: `${t(`electricity.order.revision.${line.systemKey}`, locale)} · ${line.quantityKwh} kWh`,
                    value: (
                      <span className="space-y-1 text-sm">
                        <span className="block">
                          {t('electricity.order.detail.unitPrice', locale)}:{' '}
                          {numbers.money(line.unitPriceIrR)}
                        </span>
                        <span className="block">
                          {electricityCancellationText('cancelReviewDiscount', locale)}:{' '}
                          {numbers.money(line.discountIrR)}
                        </span>
                        <span className="block">
                          {electricityCancellationText('cancelReviewNet', locale)}:{' '}
                          {numbers.money(line.netIrR)}
                        </span>
                        <span className="block">
                          {electricityCancellationText('cancelReviewVat', locale)}:{' '}
                          {numbers.money(line.vatIrR)}
                        </span>
                      </span>
                    ),
                  })
                ),
                {
                  id: 'invoice',
                  label: electricityCancellationText('cancelReviewInvoice', locale),
                  value: t(`invoices.state.${cancelReview.data.invoiceState}`, locale),
                },
                {
                  id: 'paid',
                  label: electricityCancellationText('cancelReviewPaid', locale),
                  value: numbers.money(cancelReview.data.paidAmount),
                },
                {
                  id: 'outcome',
                  label: electricityCancellationText('cancelReviewOutcome', locale),
                  value: electricityCancellationText(
                    `cancelOutcome.${cancelReview.data.outcome}`,
                    locale
                  ),
                },
                ...(cancelReview.data.refundAmount !== '0'
                  ? [
                      {
                        id: 'refund',
                        label: t('electricity.order.detail.refund', locale),
                        value: numbers.money(cancelReview.data.refundAmount),
                      },
                    ]
                  : []),
                ...(cancelReview.data.releasesGiftCode
                  ? [
                      {
                        id: 'gift-code',
                        label: electricityCancellationText('cancelReviewGiftCode', locale),
                        value: electricityCancellationText('cancelReviewGiftCodeRelease', locale),
                      },
                    ]
                  : []),
              ]}
              total={{
                label: electricityCancellationText('cancelReviewTotal', locale),
                value: numbers.money(cancelReview.data.invoiceTotal),
              }}
              notice={
                <div className="space-y-2">
                  <p>{cancelReview.data.reason}</p>
                  {typeof (
                    cancelReview.data.contractSnapshot.template as
                      Record<string, unknown> | undefined
                  )?.text === 'string' ? (
                    <p className="whitespace-pre-wrap break-words" dir="auto">
                      {(cancelReview.data.contractSnapshot.template as { text: string }).text}
                    </p>
                  ) : null}
                </div>
              }
            />
            {cancelRecovery && !cancelling && (
              <p role="alert" className="text-sm text-destructive">
                {confirmationText('unconfirmed', locale)}{' '}
                <Link
                  className="underline"
                  to={cancelError === 'stepup' ? '/settings/security' : '/tickets'}
                  target="_blank"
                  rel="noopener"
                >
                  {electricityCancellationText(
                    cancelError === 'stepup' ? 'cancelRecoverySecurity' : 'cancelRecoveryHelp',
                    locale
                  )}
                </Link>
              </p>
            )}
            <ConfirmationFields
              gate={financialGate}
              disabled={cancelling || cancelRecovery === 'check'}
            />
            <DialogFooter>
              <Button
                ref={cancelFocus}
                variant="outline"
                disabled={cancelling}
                onClick={() => (cancelRecovery ? void checkCancellation() : setCancelReview(null))}
              >
                {cancelRecovery
                  ? confirmationText('checkStatus', locale)
                  : electricityCancellationText('cancelReviewBack', locale)}
              </Button>
              <Button
                variant="destructive"
                disabled={
                  !financialGate.allowed ||
                  !!correctionLock.owner ||
                  cancelling ||
                  cancelRecovery === 'check'
                }
                onClick={() => void confirmCancellation()}
              >
                {t('electricity.order.detail.cancel', locale)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
