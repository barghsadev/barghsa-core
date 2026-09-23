import { useEffect, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { Button, Card, CardContent } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';
import { ElectricityIncreasePanel } from './ElectricityIncreasePanel.js';
import { ElectricityPriceAdjustmentsPanel } from './ElectricityPriceAdjustmentsPanel.js';
import { WorkflowStatusBanner } from '../components/WorkflowStatusBanner.js';
import { ElectricityOrderComments } from '../components/SavingOrderComments.js';

interface ElectricityOrderDetail {
  orderId: string;
  profileId: string;
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
    reason: string | null;
    comment: string | null;
  }>;
  refundStatus?: string | null;
  refundReason?: string | null;
  financiallyClosed?: boolean;
}

const statusKeys: Record<string, string> = {
  draft: 'electricity.order.status.draft',
  submitted: 'electricity.order.status.submitted',
  awaiting_staff_review: 'electricity.order.status.awaiting_staff_review',
  changes_requested: 'electricity.order.status.changes_requested',
  approved: 'electricity.order.status.approved',
  active: 'electricity.order.status.active',
  completed: 'electricity.order.status.completed',
  rejected: 'electricity.order.status.rejected',
  cancelled: 'electricity.order.status.cancelled',
};
const financialKeys: Record<string, string> = {
  unpaid: 'electricity.order.financial.unpaid',
  payment_under_review: 'electricity.order.financial.payment_under_review',
  partially_funded: 'electricity.order.financial.partially_funded',
  paid: 'electricity.order.financial.paid',
  refund_pending: 'electricity.order.financial.refund_pending',
  partially_refunded: 'electricity.order.financial.partially_refunded',
  refunded: 'electricity.order.financial.refunded',
};
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
const timelineKeys: Record<string, string> = {
  'electricity.order_submitted': 'electricity.order.timeline.submitted',
  'electricity.order_review.approve': 'electricity.order.timeline.approved',
  'electricity.order_review.request-changes': 'electricity.order.timeline.changes',
  'electricity.order_review.reject': 'electricity.order.timeline.rejected',
  'electricity.order_resubmitted': 'electricity.order.timeline.resubmitted',
  'electricity.order_cancelled': 'electricity.order.timeline.cancelled',
  'refund.processing': 'electricity.order.timeline.refundProcessing',
  'refund.completed': 'electricity.order.timeline.refundCompleted',
  'refund.failed': 'electricity.order.timeline.refundFailed',
  'refund.retry_exhausted': 'electricity.order.timeline.refundFailed',
  'contract.activated': 'electricity.order.timeline.activated',
  'contract.completed': 'electricity.order.timeline.completed',
  'contract.cancelled': 'electricity.order.timeline.cancelled',
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
  const numbers = useNumberFormatting(locale);
  const [detail, setDetail] = useState<ElectricityOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [correctedAddress, setCorrectedAddress] = useState('');
  const [correctedPostalCode, setCorrectedPostalCode] = useState('');
  const [responseNote, setResponseNote] = useState('');
  const [correctionKey, setCorrectionKey] = useState(() => crypto.randomUUID());
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelKey, setCancelKey] = useState(() => crypto.randomUUID());
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<'stepup' | 'generic' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void fetch(`/api/electricity/orders/${encodeURIComponent(orderId)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Order unavailable');
        return response.json() as Promise<ElectricityOrderDetail>;
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (
          !value ||
          value.orderId !== orderId ||
          !value.contractId ||
          !value.invoiceId ||
          !/^\d+$/.test(value.totalIrR) ||
          !/^\d+$/.test(value.paidIrR) ||
          !/^\d+$/.test(value.refundedIrR)
        )
          throw new Error('Invalid order detail');
        setDetail(value);
        setCorrectedAddress(value.fullAddress);
        setCorrectedPostalCode(value.postalCode);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [orderId, retry]);

  async function resubmitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || savingCorrection) return;
    setSavingCorrection(true);
    setCorrectionError(false);
    try {
      const response = await fetch(
        `/api/electricity/orders/${encodeURIComponent(orderId)}/resubmit-address`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            idempotencyKey: correctionKey,
            expectedVersionId: detail.versionId,
            fullAddress: correctedAddress.trim(),
            postalCode: correctedPostalCode.trim(),
            responseNote: responseNote.trim(),
          }),
        }
      );
      if (!response.ok) throw new Error('Resubmission failed');
      setCorrectionKey(crypto.randomUUID());
      setResponseNote('');
      setRetry((value) => value + 1);
    } catch {
      setCorrectionError(true);
    } finally {
      setSavingCorrection(false);
    }
  }

  async function cancelOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || cancelling || !cancelReason.trim()) return;
    if (!window.confirm(t('electricity.order.detail.cancelConfirm', locale))) return;
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
            expectedVersionId: detail.versionId,
            reason: cancelReason.trim(),
          }),
        }
      );
      if (response.status === 403) {
        setCancelError('stepup');
        return;
      }
      if (!response.ok) throw new Error('Cancellation failed');
      setCancelKey(crypto.randomUUID());
      setRetry((value) => value + 1);
    } catch {
      setCancelError('generic');
    } finally {
      setCancelling(false);
    }
  }

  const nextActionLink = detail ? nextActionHref(detail) : null;
  const latestEvent = detail?.timeline?.at(-1);
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
      {loading ? (
        <p role="status">{t('electricity.order.detailLoading', locale)}</p>
      ) : error || !detail ? (
        <div role="alert" className="space-y-3">
          <p>{t('electricity.order.detailFailed', locale)}</p>
          <Button onClick={() => setRetry((value) => value + 1)}>
            {t('electricity.order.retry', locale)}
          </Button>
        </div>
      ) : (
        <>
          <WorkflowStatusBanner
            locale={locale}
            status={t(
              statusKeys[detail.electricityStatus] ?? 'electricity.order.status.unknown',
              locale
            )}
            happened={t(
              timelineKeys[latestEvent?.event ?? ''] ??
                statusKeys[detail.electricityStatus] ??
                'electricity.order.timeline.updated',
              locale
            )}
            nextAction={t(
              actionKeys[detail.nextAction] ?? 'electricity.order.nextAction.none',
              locale
            )}
            owner={actionOwner}
            actionHref={nextActionLink}
          />
          <Card>
            <CardContent className="space-y-3 pt-6 text-sm">
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.success.order', locale)}</span>
                <strong className="break-all">{detail.orderId}</strong>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.profile', locale)}</span>
                <span className="break-all">{detail.profileId}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.period.selection', locale)}</span>
                <span>
                  {new Date(detail.periodStart).toLocaleDateString(locale)} –{' '}
                  {new Date(detail.periodEnd).toLocaleDateString(locale)}
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
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.remainingAmount', locale)}</span>
                <span>
                  {numbers.money((BigInt(detail.totalIrR) - BigInt(detail.paidIrR)).toString())}
                </span>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.deliveryAddress', locale)}</span>
                <span>{detail.fullAddress}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.financialStatus', locale)}</span>
                <span>
                  {t(
                    financialKeys[detail.financialStatus] ?? 'electricity.order.status.unknown',
                    locale
                  )}
                </span>
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 pt-6 text-sm">
              <h2 className="font-semibold">{t('electricity.order.detail.lines', locale)}</h2>
              {detail.lines?.map((line) => (
                <div
                  key={line.productId}
                  className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
                >
                  <span>
                    {line.title?.[locale] ?? line.title?.en ?? line.systemKey} ·{' '}
                    {numbers.irrDigits(line.quantityKwh)} kWh
                  </span>
                  <span>
                    {t('electricity.order.detail.unitPrice', locale)}{' '}
                    {numbers.money(line.unitPriceIrR)} · {numbers.money(line.lineTotalIrR)}
                  </span>
                </div>
              ))}
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
            <ElectricityIncreasePanel contractId={detail.contractId} versionId={detail.versionId} />
          ) : null}
          <ElectricityPriceAdjustmentsPanel contractId={detail.contractId} />
          <Card>
            <CardContent className="pt-6">
              <ElectricityOrderComments orderId={orderId} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 pt-6 text-sm">
              <h2 className="font-semibold">{t('electricity.order.detail.timeline', locale)}</h2>
              {detail.timeline?.length ? (
                <ol className="space-y-3 border-s ps-4">
                  {detail.timeline.map((event) => (
                    <li key={event.id}>
                      <time className="text-muted-foreground">
                        {new Date(event.at).toLocaleString(locale)}
                      </time>
                      <p>
                        {t(
                          timelineKeys[event.event] ?? 'electricity.order.timeline.updated',
                          locale
                        )}
                      </p>
                      {event.reason ? <p>{event.reason}</p> : null}
                      {event.comment ? <p>{event.comment}</p> : null}
                    </li>
                  ))}
                </ol>
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
              {['rejected', 'cancelled'].includes(detail.electricityStatus) ? (
                <p>
                  {t(
                    detail.financiallyClosed
                      ? 'electricity.order.detail.financiallyClosed'
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
                    disabled={cancelling || !cancelReason.trim()}
                  >
                    {t('electricity.order.detail.cancel', locale)}
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
                <form
                  className="mt-4 space-y-3"
                  onSubmit={(event) => void resubmitCorrection(event)}
                >
                  <label className="block text-sm">
                    {t('electricity.order.deliveryAddress', locale)}
                    <input
                      className="mt-1 w-full rounded-md border bg-background p-2"
                      required
                      maxLength={500}
                      value={correctedAddress}
                      onChange={(event) => setCorrectedAddress(event.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    {t('electricity.order.correction.postalCode', locale)}
                    <input
                      className="mt-1 w-full rounded-md border bg-background p-2"
                      required
                      value={correctedPostalCode}
                      onChange={(event) => setCorrectedPostalCode(event.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    {t('electricity.order.correction.responseNote', locale)}
                    <textarea
                      className="mt-1 w-full rounded-md border bg-background p-2"
                      required
                      maxLength={1000}
                      value={responseNote}
                      onChange={(event) => setResponseNote(event.target.value)}
                    />
                  </label>
                  {correctionError ? (
                    <p role="alert" className="text-destructive">
                      {t('electricity.order.correction.error', locale)}
                    </p>
                  ) : null}
                  <Button type="submit" disabled={savingCorrection || !responseNote.trim()}>
                    {t('electricity.order.correction.submit', locale)}
                  </Button>
                </form>
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
    </main>
  );
}
