import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { OrderWalletBalance } from '../components/OrderWalletBalance.js';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/workspace';
import { formatInTimezone } from '@barghsa/i18n/date-time';
import { Button, Card, CardContent, FinancialReviewSummary, Input } from '@barghsa/ui';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
  type UseFormReturn,
} from '@barghsa/ui/form';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { ElectricityIncreaseSigningReview } from '@barghsa/shared/finance';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { withCsrf } from '../lib/csrf.js';
import {
  boundIncreaseSigningReview,
  confirmedIncreaseRequest,
  confirmedIncreaseSignature,
  definitiveIncreaseRejection,
  increaseRecord,
  increaseState,
  maximumIncreaseQuantity,
  type ElectricityIncreaseDraft,
  type ElectricityIncreaseState,
} from '../lib/electricity-increase-form.js';

interface CapturedIncreaseAttempt {
  kind: 'request' | 'sign';
  body: string;
  generation: number;
  uncertain: boolean;
  snapshot: ElectricityIncreaseState;
  quantity?: string;
  review?: ElectricityIncreaseSigningReview;
}
export function ElectricityIncreasePanel({
  contractId,
  versionId,
  profileId,
  formatTimestamp,
}: {
  contractId: string;
  versionId: string;
  profileId: string;
  formatTimestamp?: (value: string) => string;
}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const scopeKey = JSON.stringify([actor, profileRevision, profileId, contractId, versionId]);
  const reader = useId();
  const client = useQueryClient();
  const readOwner = useRef({ scopeKey, epoch: 0 });
  if (readOwner.current.scopeKey !== scopeKey)
    readOwner.current = { scopeKey, epoch: readOwner.current.epoch + 1 };
  const scope = useRef(scopeKey);
  const generation = useRef(0);
  if (scope.current !== scopeKey) {
    scope.current = scopeKey;
    ++generation.current;
  }
  const timestamp =
    formatTimestamp ?? ((value: string) => formatInTimezone(value, 'Asia/Tehran', locale));
  const numbers = useNumberFormatting(locale);
  const [loadedData, setData] = useState<ElectricityIncreaseState | null>(null);
  const [acceptedScope, setAcceptedScope] = useState<string | null>(null);
  const data = acceptedScope === scopeKey ? loadedData : null;
  const dataRef = useRef(data);
  dataRef.current = data;
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<'load' | 'stepup' | 'save' | null>(null);
  const [agreed, setAgreed] = useState(false);
  const attempt = useRef<CapturedIncreaseAttempt | null>(null);
  const [captured, setCaptured] = useState<CapturedIncreaseAttempt | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const copy = (key: string) => t(`electricity.increaseForm.${key}`, locale);
  const messages = { requestedKwh: copy('quantityInvalid') };
  const form: UseFormReturn<ElectricityIncreaseDraft> = useZodForm<ElectricityIncreaseDraft>(
    async () => {
      const token = generation.current;
      const current = dataRef.current;
      const raw = form.getValues().requestedKwh;
      const schemas = await import('../lib/electricity-increase-form-schemas.js');
      return token === generation.current &&
        current &&
        current === dataRef.current &&
        raw === form.getValues().requestedKwh
        ? schemas.electricityIncreaseSchema(
            { format: copy('quantityInvalid'), range: copy('quantityRange') },
            current.originalKwh,
            maximumIncreaseQuantity(current.originalKwh, current.maxPercentage)
          )
        : schemas.inactiveIncreaseSchema;
    },
    {
      defaultValues: { requestedKwh: '' },
      validationUnavailableMessage: copy('validationUnavailable'),
    }
  );
  const fieldErrors = useActionFieldErrors(
    form,
    messages,
    t('electricity.increase.failed', locale)
  );
  function clearAttempt() {
    attempt.current = null;
    setCaptured(null);
    setUnconfirmed(false);
  }
  function withdraw() {
    ++generation.current;
    clearAttempt();
    dataRef.current = null;
    setData(null);
    setAcceptedScope(null);
    form.reset({ requestedKwh: '' });
    setAgreed(false);
    pending.current = false;
    setSaving(false);
    setLoading(false);
    setError('load');
  }
  function refresh() {
    if (scope.current !== scopeKey || pending.current || attempt.current) return;
    ++generation.current;
    dataRef.current = null;
    setData(null);
    setAcceptedScope(null);
    setAgreed(false);
    setLoading(true);
    setRetry((value) => value + 1);
  }
  useEffect(() => {
    clearAttempt();
    pending.current = false;
    setSaving(false);
    setAgreed(false);
    form.reset({ requestedKwh: '' });
    setError(null);
    return () => {
      ++generation.current;
    };
  }, [scopeKey]);
  const queryKey = queryKeys.contracts.detail(
    {
      context: 'customer',
      ownerId: profileId.trim() ? profileId : reader,
      accountId: actor,
      revision: profileRevision,
    },
    JSON.stringify([reader, 'increase', contractId, versionId, readOwner.current.epoch, retry])
  );
  const query = useServerDetailQuery<{ status: number; value: unknown }>({
    queryKey,
    enabled: false,
    manual: true,
    read: async (signal) => {
      const response = await fetch(
        `/api/electricity/contracts/${encodeURIComponent(contractId)}/increase`,
        { credentials: 'include', signal }
      );
      if ([401, 403, 404].includes(response.status))
        return { status: response.status, value: null };
      if (!response.ok) throw new Error('Increase unavailable');
      return { status: response.status, value: (await response.json()) as unknown };
    },
  });
  useEffect(() => {
    const controller = new AbortController();
    const token = generation.current;
    dataRef.current = null;
    setData(null);
    setLoading(true);
    setError(null);
    setAgreed(false);
    void query
      .refetch()
      .then((reply) => {
        if (controller.signal.aborted || token !== generation.current) return null;
        if (!reply.isSuccess || !reply.data) throw new Error('Increase unavailable');
        if ([401, 403, 404].includes(reply.data.status)) {
          withdraw();
          return null;
        }
        const value: unknown = reply.data.value;
        if (!increaseState(value)) throw new Error('Increase malformed');
        if (
          value.request &&
          (value.request.contractId !== contractId ||
            value.request.profileId !== profileId ||
            value.request.versionId !== versionId ||
            value.request.originalKwh !== value.originalKwh)
        ) {
          withdraw();
          return null;
        }
        return value;
      })
      .then((value) => {
        if (value && !controller.signal.aborted && token === generation.current) {
          dataRef.current = value;
          setData(value);
          setAcceptedScope(scopeKey);
        }
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
  }, [scopeKey, contractId, retry]);
  const maximum = data ? maximumIncreaseQuantity(data.originalKwh, data.maxPercentage) : '';
  const confirmedReview = data
    ? boundIncreaseSigningReview(data, contractId, versionId, profileId)
    : null;
  async function send(retrying: boolean) {
    if (scope.current !== scopeKey) return;
    const current = attempt.current;
    if (!current || current.generation !== generation.current) return;
    try {
      const response = await fetch(
        `/api/electricity/contracts/${encodeURIComponent(contractId)}/increase${current.kind === 'sign' ? '/sign' : ''}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: current.body,
        }
      );
      const value: unknown = await response.json().catch(() => null);
      if (current !== attempt.current || current.generation !== generation.current) return;
      if (
        response.status === 403 &&
        increaseRecord(value) &&
        increaseRecord(value.error) &&
        value.error.code === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code
      ) {
        setError('stepup');
        return;
      }
      if ([401, 403, 404].includes(response.status)) {
        withdraw();
        return;
      }
      if (!response.ok) {
        if (
          !retrying &&
          response.status >= 400 &&
          response.status < 500 &&
          definitiveIncreaseRejection(value, response.status)
        ) {
          clearAttempt();
          if (
            current.kind === 'request' &&
            response.status === 400 &&
            increaseRecord(value) &&
            increaseRecord(value.error) &&
            value.error.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
            Array.isArray(value.error.fields) &&
            fieldErrors(value.error.fields)
          )
            return;
          setError('save');
          return;
        }
        throw new Error('Increase unconfirmed');
      }
      const proven =
        current.kind === 'request'
          ? confirmedIncreaseRequest(value, {
              contractId,
              versionId,
              profileId,
              actor,
              originalKwh: current.snapshot.originalKwh,
              requestedKwh: current.quantity!,
            })
          : !!current.snapshot.request &&
            !!current.review &&
            confirmedIncreaseSignature(value, current.snapshot.request, current.review, actor);
      if (response.status !== 201 || !proven) throw new Error('Increase receipt unconfirmed');
      clearAttempt();
      pending.current = false;
      setSaving(false);
      setError(null);
      if (current.kind === 'request') form.reset({ requestedKwh: '' });
      setAgreed(false);
      refresh();
    } catch {
      if (current === attempt.current && current.generation === generation.current) {
        current.uncertain = true;
        setUnconfirmed(true);
        setError('save');
      }
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const source = dataRef.current;
    if (
      scope.current !== scopeKey ||
      !source?.canRequest ||
      source.request ||
      pending.current ||
      attempt.current
    )
      return;
    const token = generation.current;
    const raw = form.getValues().requestedKwh;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await form.handleSubmit(async () => {
        if (
          token !== generation.current ||
          source !== dataRef.current ||
          raw !== form.getValues().requestedKwh
        )
          return;
        const quantity = raw.trim();
        const command: CapturedIncreaseAttempt = {
          kind: 'request',
          body: JSON.stringify({
            requestedKwh: quantity,
            expectedVersionId: versionId,
            idempotencyKey: crypto.randomUUID(),
          }),
          generation: token,
          uncertain: false,
          snapshot: source,
          quantity,
        };
        attempt.current = command;
        setCaptured(command);
        await send(false);
      })();
    } catch {
      if (token === generation.current) setError('save');
    } finally {
      if (token === generation.current) {
        pending.current = false;
        setSaving(false);
      }
    }
  }
  async function sign() {
    const source = dataRef.current;
    if (
      scope.current !== scopeKey ||
      pending.current ||
      attempt.current ||
      !source?.request?.amendmentSha256 ||
      source.request.status !== 'awaiting_signature' ||
      !source.quote ||
      !confirmedReview ||
      !agreed
    )
      return;
    const token = generation.current;
    pending.current = true;
    setSaving(true);
    setError(null);
    const command: CapturedIncreaseAttempt = {
      kind: 'sign',
      body: JSON.stringify({
        expectedAmendmentSha256: source.request.amendmentSha256,
        expectedAdjustmentIrR: source.quote.adjustmentIrR,
        expectedReviewHash: confirmedReview.hash,
        idempotencyKey: crypto.randomUUID(),
      }),
      generation: token,
      uncertain: false,
      snapshot: source,
      review: confirmedReview,
    };
    attempt.current = command;
    setCaptured(command);
    try {
      await send(false);
    } finally {
      if (token === generation.current) {
        pending.current = false;
        setSaving(false);
      }
    }
  }
  async function retryCaptured() {
    if (scope.current !== scopeKey || pending.current || !attempt.current) return;
    const token = generation.current;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await send(true);
    } finally {
      if (token === generation.current) {
        pending.current = false;
        setSaving(false);
      }
    }
  }
  if (!loading && !error && data && !data.canRequest && !data.request) return null;
  return (
    <Card>
      <CardContent className="space-y-3 pt-6 text-sm">
        <h2 className="font-semibold">{t('electricity.increase.title', locale)}</h2>
        {loading ? <p role="status">{t('electricity.increase.loading', locale)}</p> : null}
        {error === 'load' ? (
          <Button
            data-testid="electricity-increase-refresh"
            variant="outline"
            onClick={refresh}
            disabled={saving || !!captured}
          >
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
                  {timestamp(data.request.amendmentDocument.earliestEffectiveFrom)}
                </p>
                <p>
                  {t('electricity.increase.end', locale)}:{' '}
                  {timestamp(data.request.amendmentDocument.periodEnd)}
                </p>
                <p>{t('electricity.increase.priceRule', locale)}</p>
                <p>{t('electricity.increase.activationRule', locale)}</p>
                <p className="break-all text-xs text-muted-foreground">
                  SHA-256: {data.request.amendmentSha256}
                </p>
              </section>
            ) : null}
            {data.request.status === 'awaiting_signature' && data.quote && confirmedReview ? (
              <div className="space-y-3">
                <>
                  <FinancialReviewSummary
                    title={t('electricity.increase.reviewTitle', locale)}
                    rows={[
                      {
                        id: 'contract',
                        label: t('electricity.increase.contractId', locale),
                        value: confirmedReview.data.contractId,
                      },
                      {
                        id: 'invoice',
                        label: t('electricity.increase.originalInvoice', locale),
                        value: confirmedReview.data.originalInvoiceId,
                      },
                      {
                        id: 'paid',
                        label: t('electricity.increase.paidBasis', locale),
                        value: `${numbers.irrDigits(confirmedReview.data.originalInvoiceIrR)} IRR`,
                      },
                      {
                        id: 'quantity',
                        label: t('electricity.increase.increment', locale),
                        value: `${numbers.irrDigits(confirmedReview.data.incrementalKwh)} kWh`,
                      },
                      {
                        id: 'period',
                        label: t('electricity.increase.period', locale),
                        value: `${timestamp(confirmedReview.data.periodStart)} – ${timestamp(confirmedReview.data.periodEnd)}`,
                      },
                      {
                        id: 'effective',
                        label: t('electricity.increase.earliest', locale),
                        value: timestamp(confirmedReview.data.effectiveFrom),
                      },
                      {
                        id: 'eligible',
                        label: t('electricity.increase.priceBegins', locale),
                        value: timestamp(confirmedReview.data.eligibleFrom),
                      },
                      {
                        id: 'base',
                        label: t('electricity.increase.baseShare', locale),
                        value: `${numbers.irrDigits(confirmedReview.data.baseShareIrR)} IRR`,
                      },
                      ...confirmedReview.data.priceAdjustments.map((component, index) => ({
                        id: `price-${index}`,
                        label: `${t('electricity.increase.priceChange', locale)} ${index + 1} · ${component.invoiceId}`,
                        value: `${numbers.irrDigits(component.increaseShareIrR)} IRR`,
                      })),
                    ]}
                    total={{
                      label: t('electricity.increase.adjustment', locale),
                      value: `${numbers.irrDigits(confirmedReview.data.adjustmentIrR)} IRR`,
                    }}
                    notice={t('electricity.increase.activationRule', locale)}
                  />
                  <OrderWalletBalance
                    profileId={profileId}
                    total={confirmedReview.data.adjustmentIrR}
                    scopeKey={JSON.stringify([scopeKey, confirmedReview.hash])}
                  />
                </>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={agreed}
                    disabled={saving || !!captured}
                    onChange={(event) => {
                      if (scope.current === scopeKey && !pending.current && !attempt.current)
                        setAgreed(event.target.checked);
                    }}
                  />
                  <span>{t('electricity.increase.agree', locale)}</span>
                </label>
                <Button
                  type="button"
                  loading={saving}
                  disabled={!agreed || saving || !!captured}
                  onClick={() => void sign()}
                >
                  {t('electricity.increase.sign', locale)}
                </Button>
              </div>
            ) : null}
            {data.request.status === 'awaiting_signature' && data.quote && !confirmedReview ? (
              <p role="alert">{t('electricity.increase.reviewUnavailable', locale)}</p>
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
            {error === 'save' && !captured ? (
              <p role="alert">
                {t('electricity.increase.signFailed', locale)}{' '}
                <button type="button" className="underline" onClick={refresh}>
                  {t('electricity.increase.retry', locale)}
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
        {data?.canRequest ? (
          <Form {...form}>
            <form
              noValidate
              data-testid="electricity-increase-form"
              onSubmit={(event) => void submit(event)}
              className="space-y-3"
            >
              <p>
                {t('electricity.increase.limit', locale)}: {numbers.irrDigits(maximum)} kWh
              </p>
              <FormField
                control={form.control}
                name="requestedKwh"
                render={({ field }) => (
                  <FormItem id="electricity-increase-kwh">
                    <FormLabel>{t('electricity.increase.quantity', locale)}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="text"
                        inputMode="numeric"
                        maxLength={21}
                        disabled={!!captured}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('electricity.increase.future', locale)} {copy('preserved')}
                    </FormDescription>
                    <div className="grid">
                      <p aria-hidden="true" className="invisible col-start-1 row-start-1 text-sm">
                        {copy('quantityRange')}
                      </p>
                      <FormMessage className="col-start-1 row-start-1" />
                    </div>
                  </FormItem>
                )}
              />
              {error === 'stepup' ? (
                <p role="alert">
                  {t('electricity.increase.stepup', locale)}{' '}
                  <a className="underline" href="/settings/security">
                    {t('electricity.increase.security', locale)}
                  </a>
                </p>
              ) : null}
              {(error === 'save' && !captured) || form.formState.errors.root ? (
                <p role="alert">
                  {form.formState.errors.root?.validation?.message ??
                    t('electricity.increase.failed', locale)}
                </p>
              ) : null}
              <Button type="submit" loading={saving} disabled={saving || !!captured}>
                {t('electricity.increase.submit', locale)}
              </Button>
            </form>
          </Form>
        ) : null}
        {captured && acceptedScope === scopeKey ? (
          <div className="space-y-2">
            {unconfirmed ? (
              <p role="alert">
                {copy(captured.kind === 'sign' ? 'signingUncertain' : 'uncertain')}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              data-testid={
                captured.kind === 'sign'
                  ? 'electricity-increase-sign-retry'
                  : 'electricity-increase-retry'
              }
              disabled={saving}
              onClick={() => void retryCaptured()}
            >
              {copy('retryCaptured')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
