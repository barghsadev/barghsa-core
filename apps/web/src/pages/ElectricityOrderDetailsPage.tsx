import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { contractText } from '@barghsa/i18n/contracts';
import {
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
import { ElectricityIncreasePanel } from './ElectricityIncreasePanel.js';
import { ElectricityPriceAdjustmentsPanel } from './ElectricityPriceAdjustmentsPanel.js';
import { WorkflowStatusBanner } from '../components/WorkflowStatusBanner.js';
import { ElectricityOrderComments } from '../components/SavingOrderComments.js';
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

interface ElectricityOrderDetail {
  orderId: string;
  profileId: string;
  profileName?: string;
  mode: string;
  submittedAt?: string;
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

function nextActionHref(detail: ElectricityOrderDetail): string | null {
  switch (detail.nextAction) {
    case 'pay_invoice':
    case 'await_payment_review':
    case 'await_refund':
      return `/invoices/${encodeURIComponent(detail.invoiceId)}`;
    case 'accept_contract':
      return `/contracts?contractId=${encodeURIComponent(detail.contractId)}`;
    case 'resubmit_changes':
      return '#electricity-order-correction';
    case 'continue_order':
      return '/electricity/order';
    default:
      return null;
  }
}

export function ElectricityOrderDetailsPage({ orderId }: { orderId: string }) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const actor = useAccountUser();
  const scopeKey = JSON.stringify([actor, orderId]);
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
  const [error, setError] = useState(false);
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
  const [unconfirmedCorrection, setUnconfirmedCorrection] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelKey, setCancelKey] = useState(() => crypto.randomUUID());
  const [cancelling, setCancelling] = useState(false);
  const [cancelReviewLoading, setCancelReviewLoading] = useState(false);
  const [cancelReview, setCancelReview] = useState<ElectricityCancellationReview | null>(null);
  const [cancelError, setCancelError] = useState<'stepup' | 'generic' | null>(null);
  cancellationActivity.current = cancelling || cancelReviewLoading || !!cancelReview;

  function withdraw() {
    ++generation.current;
    setDetail(null);
    setAcceptedScope(null);
    setError(true);
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
  }
  function reloadDetail() {
    if (scope.current !== scopeKey || correctionLock.owner || capturedCorrection.current) return;
    correctionPending.current = false;
    setSavingCorrection(false);
    setCancelling(false);
    setCancelReviewLoading(false);
    setCancelReview(null);
    cancellationActivity.current = false;
    ++generation.current;
    setDetail(null);
    setAcceptedScope(null);
    setLoading(true);
    setRetry((value) => value + 1);
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
    setCancelling(false);
    setCancelReviewLoading(false);
    return () => {
      ++generation.current;
    };
  }, [scopeKey]);

  useEffect(() => {
    const controller = new AbortController();
    const token = generation.current;
    setLoading(true);
    setError(false);
    void fetch(`/api/electricity/orders/${encodeURIComponent(orderId)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (controller.signal.aborted || token !== generation.current) return null;
        if ([401, 403, 404].includes(response.status)) {
          withdraw();
          return null;
        }
        if (!response.ok) throw new Error('Order unavailable');
        return response.json() as Promise<ElectricityOrderDetail>;
      })
      .then((value) => {
        if (controller.signal.aborted || token !== generation.current || !value) return;
        if (
          !value ||
          value.orderId !== orderId ||
          !correctionUuid(value.profileId) ||
          !correctionUuid(value.versionId) ||
          !correctionUuid(value.contractId) ||
          !correctionUuid(value.invoiceId) ||
          !/^\d+$/.test(value.totalIrR) ||
          !/^\d+$/.test(value.paidIrR) ||
          !/^\d+$/.test(value.refundedIrR)
        )
          throw new Error('Invalid order detail');
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
        if (!controller.signal.aborted && token === generation.current) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted && token === generation.current) setLoading(false);
      });
    return () => controller.abort();
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
    try {
      const response = await fetch(
        `/api/electricity/orders/${encodeURIComponent(orderId)}/resubmit-address`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: attempt.body,
        }
      );
      const value: unknown = await response.json().catch(() => null);
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
      reloadDetail();
    } catch {
      if (attempt === capturedCorrection.current && attempt.generation === generation.current) {
        setUnconfirmedCorrection(true);
        setCorrectionError(true);
      }
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
    if (!detail || correctionLock.owner || cancelReviewLoading || !cancelReason.trim()) return;
    const token = generation.current;
    cancellationActivity.current = true;
    setCancelReviewLoading(true);
    setCancelError(null);
    try {
      const response = await fetch(
        `/api/electricity/orders/${encodeURIComponent(orderId)}/cancel-review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ reason: cancelReason.trim() }),
        }
      );
      if (token !== generation.current) return;
      if (!response.ok) throw new Error('Review failed');
      const review = parseElectricityCancellationReview(await response.json());
      if (token !== generation.current) return;
      if (
        !review ||
        review.scope.profileId !== detail.profileId ||
        review.scope.resourceId !== orderId ||
        review.data.versionId !== detail.versionId ||
        review.data.reason !== cancelReason.trim()
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

  async function confirmCancellation() {
    if (
      !cancelReview ||
      correctionLock.owner ||
      cancelling ||
      cancelReview.scope.resourceId !== orderId
    )
      return;
    const token = generation.current;
    cancellationActivity.current = true;
    setCancelling(true);
    setCancelError(null);
    try {
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
        }
      );
      if (token !== generation.current) return;
      if (response.status === 403) {
        setCancelError('stepup');
        setCancelReview(null);
        return;
      }
      if (!response.ok) throw new Error('Cancellation failed');
      setCancelReview(null);
      setCancelKey(crypto.randomUUID());
      reloadDetail();
    } catch {
      if (token !== generation.current) return;
      setCancelReview(null);
      setCancelError('generic');
      reloadDetail();
    } finally {
      if (token === generation.current) {
        cancellationActivity.current = false;
        setCancelling(false);
      }
    }
  }

  const nextActionLink = detail ? nextActionHref(detail) : null;
  const latestEvent = detail?.timeline?.at(-1);
  const terminalOrder =
    detail !== null && ['rejected', 'cancelled'].includes(detail.electricityStatus);
  const refundRemaining = detail ? BigInt(detail.paidIrR) - BigInt(detail.refundedIrR) : 0n;
  const actionOwner =
    detail?.nextAction === 'none'
      ? 'none'
      : ['pay_invoice', 'accept_contract', 'resubmit_changes', 'continue_order'].includes(
            detail?.nextAction ?? ''
          )
        ? 'customer'
        : 'staff';
  return (
    <main
      className="container mx-auto max-w-2xl space-y-6 px-4 py-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header>
        <Link
          to="/electricity/orders"
          className="text-sm text-primary underline underline-offset-4"
        >
          {t('electricity.order.detail.back', locale)}
        </Link>
        <h1 className="text-2xl font-bold">{t('electricity.order.detail.title', locale)}</h1>
        <p className="mt-2 text-muted-foreground">
          {t('electricity.order.detail.description', locale)}
        </p>
      </header>
      {time.notice}
      {loading ? (
        <p role="status">{t('electricity.order.detailLoading', locale)}</p>
      ) : error || !detail ? (
        <div role="alert" className="space-y-3">
          <p>{t('electricity.order.detailFailed', locale)}</p>
          <Button onClick={() => reloadDetail()}>{t('electricity.order.retry', locale)}</Button>
        </div>
      ) : (
        <>
          <WorkflowStatusBanner
            locale={locale}
            status={t(electricityStatusKey(detail.electricityStatus, 'commercial'), locale)}
            happened={t(
              latestEvent
                ? electricityTimelineKey(latestEvent.event)
                : electricityStatusKey(detail.electricityStatus, 'commercial'),
              locale
            )}
            nextAction={t(
              actionKeys[detail.nextAction] ?? 'electricity.order.nextAction.none',
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
          {detail.contractState === 'Active' ? (
            <ElectricityIncreasePanel
              contractId={detail.contractId}
              profileId={detail.profileId}
              versionId={detail.versionId}
              formatTimestamp={time.format}
            />
          ) : null}
          <ElectricityPriceAdjustmentsPanel
            contractId={detail.contractId}
            profileId={detail.profileId}
            versionId={detail.versionId}
            formatTimestamp={time.format}
          />
          <Card>
            <CardContent className="pt-6">
              <ElectricityOrderComments orderId={orderId} formatTimestamp={time.format} />
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
                    actorLabel: event.actorName ?? undefined,
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
              <Link to="/tickets" className="text-primary underline underline-offset-4">
                {t('electricity.order.detail.help', locale)}
              </Link>
            </CardContent>
          </Card>
          {['awaiting_staff_review', 'changes_requested'].includes(detail.electricityStatus) ? (
            <Card>
              <CardContent className="pt-6">
                <form onSubmit={(event) => void cancelOrder(event)} className="space-y-3">
                  <label className="block text-sm">
                    {t('electricity.order.detail.cancelReason', locale)}
                    <textarea
                      className="mt-1 w-full rounded-md border bg-background p-2"
                      required
                      maxLength={1000}
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                    />
                  </label>
                  {cancelError ? (
                    <p role="alert" className="text-destructive">
                      {t(
                        cancelError === 'stepup'
                          ? 'electricity.order.detail.cancelStepUp'
                          : 'electricity.order.detail.cancelFailed',
                        locale
                      )}
                      {cancelError === 'stepup' ? (
                        <Link to="/settings/security" className="ms-2 underline">
                          {t('electricity.order.detail.security', locale)}
                        </Link>
                      ) : null}
                    </p>
                  ) : null}
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={
                      !!correctionLock.owner ||
                      cancelling ||
                      cancelReviewLoading ||
                      !cancelReason.trim()
                    }
                  >
                    {t(
                      cancelReviewLoading
                        ? 'electricity.order.detail.cancelReviewLoading'
                        : 'electricity.order.detail.cancel',
                      locale
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
          {detail.electricityStatus === 'changes_requested' ? (
            <Card id="electricity-order-correction">
              <CardContent className="pt-6">
                <h2 className="font-semibold">{t('electricity.order.correction.title', locale)}</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('electricity.order.correction.description', locale)}
                </p>
                <Form {...correctionForm}>
                  <form
                    noValidate
                    data-testid="electricity-address-correction-form"
                    className="mt-4 space-y-3"
                    onSubmit={(event) => void resubmitCorrection(event)}
                  >
                    {(['fullAddress', 'postalCode', 'responseNote'] as const).map((name) => (
                      <FormField
                        key={name}
                        control={correctionForm.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem
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
                                  maxLength={1000}
                                  disabled={!!correctionLock.owner}
                                />
                              ) : (
                                <Input
                                  {...field}
                                  maxLength={name === 'fullAddress' ? 500 : 10}
                                  inputMode={name === 'postalCode' ? 'numeric' : 'text'}
                                  disabled={!!correctionLock.owner}
                                />
                              )}
                            </FormControl>
                            <FormDescription>
                              {t('electricity.correctionForm.help', locale)}
                            </FormDescription>
                            <div className="grid">
                              <p
                                aria-hidden="true"
                                className="invisible col-start-1 row-start-1 text-sm"
                              >
                                {correctionMessages[name]}
                              </p>
                              <FormMessage className="col-start-1 row-start-1" />
                            </div>
                          </FormItem>
                        )}
                      />
                    ))}
                    {correctionError || correctionForm.formState.errors.root ? (
                      <p role="alert" className="text-destructive">
                        {unconfirmedCorrection
                          ? t('electricity.correctionForm.uncertain', locale)
                          : (correctionForm.formState.errors.root?.validation?.message ??
                            t('electricity.order.correction.error', locale))}
                      </p>
                    ) : null}
                    {correctionLock.owner === 'revision' ? (
                      <p role="status">{t('electricity.correctionForm.busy', locale)}</p>
                    ) : null}
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
                  </form>
                </Form>
                <Suspense fallback={null}>
                  <ElectricityOrderRevisionForm
                    key={JSON.stringify([scopeKey, detail.profileId, detail.versionId])}
                    order={detail}
                    onComplete={() => reloadDetail()}
                    coordination={correctionLock}
                    onDenied={withdraw}
                  />
                </Suspense>
              </CardContent>
            </Card>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {['AwaitingCustomerAcceptance', 'Accepted', 'Signed', 'Active', 'Completed'].includes(
              detail.contractState
            ) ? (
              <Link
                to="/contracts"
                search={{ contractId: detail.contractId }}
                className="rounded-md border px-4 py-2 text-sm text-primary underline underline-offset-4"
              >
                {t('electricity.order.success.contract', locale)}: {detail.contractId}
              </Link>
            ) : (
              <span className="rounded-md border px-4 py-2 text-sm text-muted-foreground">
                {t('electricity.order.contractPending', locale)}: {detail.contractId}
              </span>
            )}
            <Link
              to="/invoices/$invoiceId"
              params={{ invoiceId: detail.invoiceId }}
              className="rounded-md border px-4 py-2 text-sm text-primary underline underline-offset-4"
            >
              {t('electricity.order.financialReviewLink', locale)}: {detail.invoiceId}
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
        <Dialog open onOpenChange={(open) => !open && !cancelling && setCancelReview(null)}>
          <DialogContent
            className="max-h-[90dvh] overflow-y-auto"
            dir={locale === 'fa' ? 'rtl' : 'ltr'}
            showCloseButton={!cancelling}
          >
            <DialogHeader>
              <DialogTitle>{t('electricity.order.detail.cancelReviewTitle', locale)}</DialogTitle>
              <DialogDescription>
                {t('electricity.order.detail.cancelConfirm', locale)}
              </DialogDescription>
            </DialogHeader>
            <FinancialReviewSummary
              title={t('electricity.order.detail.cancelReviewTitle', locale)}
              rows={[
                {
                  id: 'profile',
                  label: t('electricity.order.detail.cancelReviewProfile', locale),
                  value: cancelReview.data.profileName,
                },
                {
                  id: 'period',
                  label: t('electricity.order.detail.cancelReviewPeriod', locale),
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
                          {t('electricity.order.detail.cancelReviewDiscount', locale)}:{' '}
                          {numbers.money(line.discountIrR)}
                        </span>
                        <span className="block">
                          {t('electricity.order.detail.cancelReviewNet', locale)}:{' '}
                          {numbers.money(line.netIrR)}
                        </span>
                        <span className="block">
                          {t('electricity.order.detail.cancelReviewVat', locale)}:{' '}
                          {numbers.money(line.vatIrR)}
                        </span>
                      </span>
                    ),
                  })
                ),
                {
                  id: 'invoice',
                  label: t('electricity.order.detail.cancelReviewInvoice', locale),
                  value: t(`invoices.state.${cancelReview.data.invoiceState}`, locale),
                },
                {
                  id: 'paid',
                  label: t('electricity.order.detail.cancelReviewPaid', locale),
                  value: numbers.money(cancelReview.data.paidAmount),
                },
                {
                  id: 'outcome',
                  label: t('electricity.order.detail.cancelReviewOutcome', locale),
                  value: t(
                    `electricity.order.detail.cancelOutcome.${cancelReview.data.outcome}`,
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
                        label: t('electricity.order.detail.cancelReviewGiftCode', locale),
                        value: t('electricity.order.detail.cancelReviewGiftCodeRelease', locale),
                      },
                    ]
                  : []),
              ]}
              total={{
                label: t('electricity.order.detail.cancelReviewTotal', locale),
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
            <DialogFooter>
              <Button variant="outline" disabled={cancelling} onClick={() => setCancelReview(null)}>
                {t('electricity.order.detail.cancelReviewBack', locale)}
              </Button>
              <Button
                variant="destructive"
                disabled={!!correctionLock.owner || cancelling}
                onClick={() => void confirmCancellation()}
              >
                {t('electricity.order.detail.cancel', locale)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </main>
  );
}
