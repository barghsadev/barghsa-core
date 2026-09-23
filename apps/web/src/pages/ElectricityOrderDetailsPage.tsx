import { useEffect, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/app';
import { Button, Card, CardContent } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';

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
  resubmit_changes: 'electricity.order.nextAction.resubmit_changes',
  pay_invoice: 'electricity.order.nextAction.pay_invoice',
  accept_contract: 'electricity.order.nextAction.accept_contract',
  await_refund: 'electricity.order.nextAction.await_refund',
  await_delivery: 'electricity.order.nextAction.await_delivery',
  await_activation: 'electricity.order.nextAction.await_activation',
  continue_order: 'electricity.order.nextAction.continue_order',
  none: 'electricity.order.nextAction.none',
};

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

  return (
    <main
      className="container mx-auto max-w-2xl space-y-6 px-4 py-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header>
        <h1 className="text-2xl font-bold">{t('electricity.order.success.title', locale)}</h1>
        <p className="mt-2 text-muted-foreground">
          {t('electricity.order.success.description', locale)}
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
                <span>{t('electricity.order.commercialStatus', locale)}</span>
                <span>
                  {t(
                    statusKeys[detail.electricityStatus] ?? 'electricity.order.status.unknown',
                    locale
                  )}
                </span>
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
            <CardContent className="pt-6">
              <h2 className="font-semibold">{t('electricity.order.nextAction', locale)}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t(actionKeys[detail.nextAction] ?? 'electricity.order.nextAction.none', locale)}
              </p>
            </CardContent>
          </Card>
          {detail.electricityStatus === 'changes_requested' ? (
            <Card>
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
              <a
                href="/contracts"
                className="rounded-md border px-4 py-2 text-sm text-primary underline underline-offset-4"
              >
                {t('electricity.order.success.contract', locale)}: {detail.contractId}
              </a>
            ) : (
              <span className="rounded-md border px-4 py-2 text-sm text-muted-foreground">
                {t('electricity.order.contractPending', locale)}: {detail.contractId}
              </span>
            )}
            <a
              href={`/invoices/${detail.invoiceId}`}
              className="rounded-md border px-4 py-2 text-sm text-primary underline underline-offset-4"
            >
              {t('electricity.order.financialReviewLink', locale)}: {detail.invoiceId}
            </a>
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
