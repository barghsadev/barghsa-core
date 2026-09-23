import { useEffect, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/app';
import { Button, Card, CardContent } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';

interface IncreaseRequest {
  requestedKwh: string;
  status: string;
  reviewReason: string | null;
  createdAt: string;
  amendmentSha256: string | null;
  adjustmentInvoiceId: string | null;
  adjustmentAmount: string | null;
  effectiveAt: string | null;
  expiredAt: string | null;
  adjustmentInvoiceState: string | null;
  adjustmentPaidAmount: string | null;
  financialFollowUp: boolean;
  amendmentDocument: {
    originalKwh: string;
    requestedKwh: string;
    incrementalKwh: string;
    earliestEffectiveFrom: string;
    periodEnd: string;
    pricingRule: string;
    activationRule: string;
  } | null;
}
interface IncreaseState {
  request: IncreaseRequest | null;
  maxPercentage: number;
  originalKwh: string;
  canRequest: boolean;
  quote: { adjustmentIrR: string; eligibleFrom: string } | null;
}

export function ElectricityIncreasePanel({
  contractId,
  versionId,
}: {
  contractId: string;
  versionId: string;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [data, setData] = useState<IncreaseState | null>(null);
  const [quantity, setQuantity] = useState('');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'load' | 'stepup' | 'save' | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [signKey, setSignKey] = useState(() => crypto.randomUUID());
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setLoading(true);
    setError(null);
    void fetch(`/api/electricity/contracts/${encodeURIComponent(contractId)}/increase`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Increase unavailable');
        return response.json() as Promise<IncreaseState>;
      })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('load');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [contractId, retry]);

  const maximum = data
    ? (() => {
        const limit =
          BigInt(data.originalKwh) + (BigInt(data.originalKwh) * BigInt(data.maxPercentage)) / 100n;
        return (limit < 9_223_372_036_854_775_807n ? limit : 9_223_372_036_854_775_807n).toString();
      })()
    : '';
  const valid =
    data &&
    /^\d+$/.test(quantity) &&
    BigInt(quantity) > BigInt(data.originalKwh) &&
    BigInt(quantity) <= BigInt(maximum);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/electricity/contracts/${encodeURIComponent(contractId)}/increase`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            requestedKwh: quantity,
            expectedVersionId: versionId,
            idempotencyKey: key,
          }),
        }
      );
      if (response.status === 403) {
        setError('stepup');
        return;
      }
      if (!response.ok) throw new Error('Increase request failed');
      setKey(crypto.randomUUID());
      setRetry((value) => value + 1);
    } catch {
      setError('save');
    } finally {
      setSaving(false);
    }
  }

  async function sign() {
    if (!data?.request?.amendmentSha256 || !data.quote || !agreed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/electricity/contracts/${encodeURIComponent(contractId)}/increase/sign`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            expectedAmendmentSha256: data.request.amendmentSha256,
            expectedAdjustmentIrR: data.quote.adjustmentIrR,
            idempotencyKey: signKey,
          }),
        }
      );
      if (response.status === 403) {
        setError('stepup');
        return;
      }
      if (!response.ok) throw new Error('Signature unavailable');
      setSignKey(crypto.randomUUID());
      setAgreed(false);
      setRetry((value) => value + 1);
    } catch {
      setError('save');
    } finally {
      setSaving(false);
    }
  }

  if (!loading && !error && data && !data.canRequest && !data.request) return null;
  return (
    <Card>
      <CardContent className="space-y-3 pt-6 text-sm">
        <h2 className="font-semibold">{t('electricity.increase.title', locale)}</h2>
        {loading ? <p role="status">{t('electricity.increase.loading', locale)}</p> : null}
        {error === 'load' ? (
          <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
            {t('electricity.increase.retry', locale)}
          </Button>
        ) : null}
        {data?.request ? (
          <div className="space-y-2">
            <p>
              {t('electricity.increase.requested', locale)}:{' '}
              {numbers.irrDigits(data.request.requestedKwh)} kWh
            </p>
            <p>{t(`electricity.increase.status.${data.request.status}`, locale)}</p>
            {data.request.reviewReason ? (
              <p>
                {t('electricity.increase.reason', locale)}: {data.request.reviewReason}
              </p>
            ) : null}
            {data.request.amendmentDocument ? (
              <section
                className="rounded-md border p-3"
                aria-label={t('electricity.increase.amendment', locale)}
              >
                <h3 className="font-semibold">{t('electricity.increase.amendment', locale)}</h3>
                <p>
                  {t('electricity.increase.increment', locale)}:{' '}
                  {numbers.irrDigits(data.request.amendmentDocument.incrementalKwh)} kWh
                </p>
                <p>
                  {t('electricity.increase.earliest', locale)}:{' '}
                  {new Date(data.request.amendmentDocument.earliestEffectiveFrom).toLocaleString(
                    locale
                  )}
                </p>
                <p>
                  {t('electricity.increase.end', locale)}:{' '}
                  {new Date(data.request.amendmentDocument.periodEnd).toLocaleString(locale)}
                </p>
                <p>{t('electricity.increase.priceRule', locale)}</p>
                <p>{t('electricity.increase.activationRule', locale)}</p>
                <p className="break-all text-xs text-muted-foreground">
                  SHA-256: {data.request.amendmentSha256}
                </p>
              </section>
            ) : null}
            {data.request.status === 'awaiting_signature' && data.quote ? (
              <div className="space-y-3">
                <p>
                  {t('electricity.increase.adjustment', locale)}:{' '}
                  {numbers.irrDigits(data.quote.adjustmentIrR)} IRR
                </p>
                <p>
                  {t('electricity.increase.priceBegins', locale)}:{' '}
                  {new Date(data.quote.eligibleFrom).toLocaleString(locale)}
                </p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(event) => setAgreed(event.target.checked)}
                  />
                  <span>{t('electricity.increase.agree', locale)}</span>
                </label>
                <Button type="button" disabled={!agreed || saving} onClick={() => void sign()}>
                  {t('electricity.increase.sign', locale)}
                </Button>
              </div>
            ) : null}
            {data.request.adjustmentInvoiceId ? (
              <p>
                <a
                  className="text-primary underline"
                  href={`/invoices/${encodeURIComponent(data.request.adjustmentInvoiceId)}`}
                >
                  {t(
                    data.request.adjustmentInvoiceState === 'Cancelled'
                      ? 'electricity.increase.cancelledInvoice'
                      : 'electricity.increase.payInvoice',
                    locale
                  )}
                </a>
              </p>
            ) : null}
            {data.request.status === 'expired' &&
            data.request.adjustmentInvoiceState === 'Cancelled' ? (
              <p>{t('electricity.increase.noPaymentDue', locale)}</p>
            ) : null}
            {data.request.financialFollowUp ? (
              <p role="status">{t('electricity.increase.financeFollowUp', locale)}</p>
            ) : null}
            {error === 'stepup' ? (
              <p role="alert">
                {t('electricity.increase.stepup', locale)}{' '}
                <a className="underline" href="/settings/security">
                  {t('electricity.increase.security', locale)}
                </a>
              </p>
            ) : null}
            {error === 'save' ? (
              <p role="alert">
                {t('electricity.increase.signFailed', locale)}{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  {t('electricity.increase.retry', locale)}
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
        {data?.canRequest ? (
          <form onSubmit={(event) => void submit(event)} className="space-y-3">
            <p>
              {t('electricity.increase.limit', locale)}: {numbers.irrDigits(maximum)} kWh
            </p>
            <label className="block" htmlFor="electricity-increase-kwh">
              {t('electricity.increase.quantity', locale)}
            </label>
            <input
              id="electricity-increase-kwh"
              type="number"
              min={(BigInt(data.originalKwh) + 1n).toString()}
              max={maximum}
              step="1"
              required
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="w-full rounded-md border bg-background p-2"
            />
            <p className="text-muted-foreground">{t('electricity.increase.future', locale)}</p>
            {error === 'stepup' ? (
              <p role="alert">
                {t('electricity.increase.stepup', locale)}{' '}
                <a className="underline" href="/settings/security">
                  {t('electricity.increase.security', locale)}
                </a>
              </p>
            ) : null}
            {error === 'save' ? (
              <p role="alert">{t('electricity.increase.failed', locale)}</p>
            ) : null}
            <Button type="submit" disabled={!valid || saving}>
              {t('electricity.increase.submit', locale)}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
