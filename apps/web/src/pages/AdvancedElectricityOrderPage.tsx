import { commercialFetch as fetch } from '../lib/commercial-fetch.js';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { Button, Card, CardContent, DateTimePicker } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { toast } from '../lib/toast-api.js';
import { StepReviewPage } from '../components/StepReviewPage.js';
import { ValidatedFormWizard } from '../components/ValidatedFormWizard.js';
import { useWizardForm, type WizardFieldBinding } from '../hooks/useWizardForm.js';
import { z } from 'zod';
import { WalletFundingPrompt } from '../components/WalletFundingPrompt.js';
import { ElectricityQuoteErrorNotice } from '../components/ElectricityQuoteErrorNotice.js';
import { ElectricityFinancialReviewSummary } from '../components/ElectricityFinancialReviewSummary.js';
import {
  ElectricityContractTerms,
  type ElectricityContractTermsSnapshot,
} from '../components/ElectricityContractTerms.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';
import { useWizardStep } from '../hooks/useWizardStep.js';
import { confirmedDraftReceipt, electricityOrderReceipt } from '../lib/form-receipt.js';
import { formatJalaliDateTime, parseJalaliDateTime } from '../lib/jalali-date-time.js';
import {
  ElectricityQuotePreviewError,
  electricityQuoteError,
} from '../lib/electricity-quote-error.js';

type Key = 'thermal' | 'green' | 'free_market' | 'energy_saving';
const keys: Key[] = ['thermal', 'green', 'free_market', 'energy_saving'];
type Product = {
  systemKey: Key;
  title: Record<string, string> | null;
  price: string | null;
  status: string;
  orderable: boolean;
  limits: { minKwh: string; maxKwh: string };
};
type Address = {
  id: string;
  provinceId: string;
  cityId: string;
  fullAddress: string;
  postalCode: string;
  mainAddress: boolean;
};
type Quote = {
  reviewDigest: string;
  contractTemplate?: ElectricityContractTermsSnapshot | null;
  periodStart: string;
  periodEnd: string;
  durationHours: string;
  totalKwh: string;
  averagePowerKw: string;
  greenRuleApplies: boolean;
  mandatoryGreenEnabled: boolean;
  walletBalanceIrR: string;
  lines: Array<{
    systemKey: Key;
    quantityKwh: string;
    unitPriceIrR: string;
    subtotalIrR: string;
    discountIrR: string;
    vatIrR: string;
    totalIrR: string;
  }>;
  subtotalIrR: string;
  discountIrR: string;
  vatIrR: string;
  totalIrR: string;
};
type Draft = {
  currentStep: number;
  data: {
    startAt?: string;
    endAt?: string;
    quantities: Partial<Record<Key, string>>;
    giftCode?: string;
    addressId?: string;
  } | null;
};
const emptyQuantities: Record<Key, string> = {
  thermal: '',
  green: '',
  free_market: '',
  energy_saving: '',
};
const LeaveDialog = lazy(() => import('../components/WizardLeaveDialog.js'));
const fieldClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm';
const iranCivil = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

function civilDay(date: Date): number {
  const fields = Object.fromEntries(
    iranCivil
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  return Date.UTC(fields.year!, fields.month! - 1, fields.day!);
}

function invalidPeriod(
  start: string,
  end: string,
  options: { limits: { leadTimeDays: number; maxContractDuration: number } } | null
): 'start' | 'end' | undefined {
  const startAt = parseJalaliDateTime(start),
    endAt = parseJalaliDateTime(end);
  if (
    !options ||
    !startAt ||
    new Date(startAt) < new Date() ||
    civilDay(new Date(startAt)) < civilDay(new Date()) + options.limits.leadTimeDays * 86_400_000
  )
    return 'start';
  if (!endAt || new Date(endAt) <= new Date(startAt)) return 'end';
  const months =
    (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
    Number(end.slice(5, 7)) -
    Number(start.slice(5, 7));
  if (
    months > options.limits.maxContractDuration ||
    (months === options.limits.maxContractDuration && end.slice(8) > start.slice(8))
  )
    return 'end';
  return undefined;
}

export function JalaliTimeInput({
  id,
  label,
  value,
  onChange,
  binding,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  binding?: WizardFieldBinding;
}) {
  const locale = useLocale();
  const instant = parseJalaliDateTime(value);
  return (
    <DateTimePicker
      id={id}
      label={label}
      {...(binding ? { triggerProps: binding, onBlur: binding.onBlur } : {})}
      locale={locale}
      timezone="Asia/Tehran"
      value={instant ? new Date(instant) : undefined}
      onChange={(date) => onChange(date ? formatJalaliDateTime(date) : '')}
    />
  );
}

export function AdvancedElectricityOrderPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const navigate = useNavigate();
  const [profileId, setProfileId] = useState('');
  const [profileName, setProfileName] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [options, setOptions] = useState<{
    limits: { leadTimeDays: number; maxContractDuration: number };
    mandatoryGreenEnabled: boolean;
  } | null>(null);
  const fields = useWizardForm(
    z
      .object({
        start: z.string(),
        end: z.string(),
        quantities: z.object({
          thermal: z.string(),
          green: z.string(),
          free_market: z.string(),
          energy_saving: z.string(),
        }),
        addressId: z
          .string()
          .refine(
            (value) => addresses.some((address) => address.id === value),
            t('electricity.order.selectAddress', locale)
          ),
        giftCode: z.string(),
      })
      .superRefine((value, context) => {
        const invalid = invalidPeriod(value.start, value.end, options);
        if (invalid)
          context.addIssue({
            code: 'custom',
            path: [invalid],
            message: t('formWizard.invalidField', locale),
          });
        const active = keys.filter((key) => !(key === 'green' && options?.mandatoryGreenEnabled));
        for (const key of active)
          if (!/^\d{1,19}$/.test(value.quantities[key] || '0'))
            context.addIssue({
              code: 'custom',
              path: ['quantities', key],
              message: t('electricity.order.quantityInvalid', locale),
            });
        if (!active.some((key) => /^[1-9]\d*$/.test(value.quantities[key]))) {
          const key =
            products.find((product) => product.orderable && active.includes(product.systemKey))
              ?.systemKey ?? 'thermal';
          context.addIssue({
            code: 'custom',
            path: ['quantities', key],
            message: t('electricity.order.quantityInvalid', locale),
          });
        }
      }),
    () => ({
      start: formatJalaliDateTime(new Date(Date.now() + 86_400_000)),
      end: formatJalaliDateTime(new Date(Date.now() + 31 * 86_400_000)),
      quantities: emptyQuantities,
      addressId: '',
      giftCode: '',
    })
  );
  const [start, setStart] = fields.field('start');
  const [end, setEnd] = fields.field('end');
  const [quantities, setQuantities] = fields.field('quantities');
  const [addressId, setAddressId] = fields.field('addressId');
  const [giftCode, setGiftCode] = fields.field('giftCode');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteVersion, setQuoteVersion] = useState(0);
  const [quoteError, setQuoteError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [draftAttempt, setDraftAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const wizard = useWizardStep('/electricity/advanced');
  const { step } = wizard;
  const command = useRef<symbol | null>(null);
  const generation = useRef(0);
  const completed = useRef(false);
  const savedSignature = useRef('');
  const signature = JSON.stringify([start, end, quantities, giftCode, addressId]);
  const liveSignature = useRef(signature);
  useLayoutEffect(() => {
    liveSignature.current = signature;
  }, [signature]);
  const hasUnsavedChanges = () =>
    !loading && !loadError && liveSignature.current !== savedSignature.current;
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      !completed.current &&
      (hasUnsavedChanges() || !!command.current || fields.isPending()),
    enableBeforeUnload: () =>
      !completed.current && (hasUnsavedChanges() || !!command.current || fields.isPending()),
    withResolver: true,
  });
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const selectedAddress = addresses.find((address) => address.id === addressId);
  const startAt = useMemo(() => parseJalaliDateTime(start), [start]);
  const endAt = useMemo(() => parseJalaliDateTime(end), [end]);
  const quantityPayload = useMemo<Record<Key, string>>(
    () => ({
      thermal: quantities.thermal || '0',
      green: options?.mandatoryGreenEnabled ? '0' : quantities.green || '0',
      free_market: quantities.free_market || '0',
      energy_saving: quantities.energy_saving || '0',
    }),
    [quantities, options?.mandatoryGreenEnabled]
  );
  const quantitiesValid =
    keys.some((key) => /^[1-9]\d*$/.test(quantityPayload[key])) &&
    keys.every((key) => /^\d{1,19}$/.test(quantityPayload[key]));
  const validPeriod = !invalidPeriod(start, end, options);
  const previewInput = useMemo(
    () => ({
      profileId,
      startAt,
      endAt,
      quantities: quantityPayload,
      ...(giftCode.trim() ? { giftCode: giftCode.trim() } : {}),
    }),
    [profileId, startAt, endAt, quantityPayload, giftCode]
  );

  useEffect(() => {
    const abort = new AbortController();
    void Promise.all([
      fetch('/api/profiles/verification-status', { credentials: 'include', signal: abort.signal }),
      fetch('/api/products/electricity', { credentials: 'include', signal: abort.signal }),
      fetch('/api/electricity/periods/advanced', { credentials: 'include', signal: abort.signal }),
    ])
      .then(async ([profile, catalogue, settings]) => {
        if (!profile.ok || !catalogue.ok || !settings.ok) throw new Error('Unavailable');
        const [status, items, limits] = await Promise.all([
          profile.json(),
          catalogue.json(),
          settings.json(),
        ]);
        if (
          !status.activeProfileId ||
          !Array.isArray(items) ||
          items.length !== 4 ||
          typeof limits?.limits?.maxContractDuration !== 'number'
        )
          throw new Error('Invalid data');
        if (abort.signal.aborted) return;
        setProfileId(status.activeProfileId);
        setProfileName(
          typeof status.activeProfileName === 'string' && status.activeProfileName.trim()
            ? status.activeProfileName.trim()
            : null
        );
        setBlocked(
          status.profileStatus === 'DRAFT' ||
            status.profileStatus === 'SUSPENDED' ||
            (status.verificationRequired && !status.isVerified)
        );
        setProducts(items);
        setOptions(limits);
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setLoadError(true);
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [bootstrapAttempt]);

  useEffect(() => {
    if (!profileId) return;
    const epoch = ++generation.current;
    const abort = new AbortController();
    wizard.reset();
    command.current = null;
    completed.current = false;
    setSaving(false);
    setSubmitting(false);
    setLoading(true);
    void Promise.all([
      fetch(`/api/profiles/${profileId}/addresses`, {
        credentials: 'include',
        signal: abort.signal,
      }),
      fetch(`/api/electricity/drafts/advanced?profileId=${profileId}`, {
        credentials: 'include',
        signal: abort.signal,
      }),
    ])
      .then(async ([addressResponse, draftResponse]) => {
        if (!addressResponse.ok || !draftResponse.ok) throw new Error('Unavailable');
        const addressData: { addresses: Address[] } = await addressResponse.json();
        const draft: Draft = await draftResponse.json();
        if (abort.signal.aborted) return;
        if (
          !Array.isArray(addressData.addresses) ||
          !draft ||
          !Number.isInteger(draft.currentStep) ||
          draft.currentStep < 1 ||
          draft.currentStep > 5 ||
          (draft.currentStep > 1 && !draft.data) ||
          (draft.data !== null &&
            (!draft.data ||
              typeof draft.data !== 'object' ||
              Array.isArray(draft.data) ||
              !draft.data.quantities ||
              typeof draft.data.quantities !== 'object' ||
              Array.isArray(draft.data.quantities) ||
              Object.entries(draft.data.quantities).some(
                ([key, quantity]) =>
                  !keys.includes(key as Key) ||
                  typeof quantity !== 'string' ||
                  !/^\d{1,19}$/.test(quantity)
              ) ||
              [draft.data.startAt, draft.data.endAt].some(
                (date) =>
                  date !== undefined &&
                  (typeof date !== 'string' || !Number.isFinite(Date.parse(date)))
              ) ||
              (draft.data.giftCode !== undefined && typeof draft.data.giftCode !== 'string') ||
              (draft.data.addressId !== undefined && typeof draft.data.addressId !== 'string')))
        )
          throw new Error('Invalid draft');
        setAddresses(addressData.addresses);
        const restoredAddress =
          draft.data?.addressId ??
          (addressData.addresses.find((address) => address.mainAddress) ?? addressData.addresses[0])
            ?.id ??
          '';
        const restoredStart = draft.data?.startAt
          ? formatJalaliDateTime(new Date(draft.data.startAt))
          : start;
        const restoredEnd = draft.data?.endAt
          ? formatJalaliDateTime(new Date(draft.data.endAt))
          : end;
        const restoredQuantities = { ...emptyQuantities, ...draft.data?.quantities };
        const restoredGift = draft.data?.giftCode ?? '';
        setAddressId(restoredAddress);
        setStart(restoredStart);
        setEnd(restoredEnd);
        setQuantities(restoredQuantities);
        setGiftCode(restoredGift);
        savedSignature.current = JSON.stringify([
          restoredStart,
          restoredEnd,
          restoredQuantities,
          restoredGift,
          restoredAddress,
        ]);
        wizard.restore(draft.currentStep);
        setLoadError(false);
        setLoading(false);
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setLoadError(true);
          setLoading(false);
        }
      });
    return () => {
      abort.abort();
      command.current = null;
      if (generation.current === epoch) generation.current++;
    };
  }, [profileId, draftAttempt]);

  useEffect(() => {
    setQuote(null);
    setQuoteError('');
    if (!profileId || blocked || !validPeriod || !quantitiesValid || !options) return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      setQuoteError('');
      void fetch('/api/electricity/preview/advanced', {
        method: 'POST',
        credentials: 'include',
        signal: abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewInput),
      })
        .then(async (response) => {
          if (!response.ok)
            throw new ElectricityQuotePreviewError(await electricityQuoteError(response, locale));
          const value = (await response.json()) as Quote;
          if (!abort.signal.aborted) setQuote(value);
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted)
            setQuoteError(
              error instanceof ElectricityQuotePreviewError
                ? error.message
                : t('electricity.order.previewUnavailable', locale)
            );
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [
    profileId,
    blocked,
    validPeriod,
    quantitiesValid,
    options,
    previewInput,
    locale,
    quoteVersion,
  ]);

  async function saveDraft(next: boolean, target = next ? step + 1 : step) {
    if (next && step === 4 && !selectedAddress) return false;
    if (
      command.current ||
      completed.current ||
      loading ||
      loadError ||
      blocked ||
      !profileId ||
      target < 1 ||
      target > 5
    )
      return false;
    if (
      next &&
      (step === 1 ? !validPeriod : !quote || !validPeriod || !quantitiesValid || quoteError)
    )
      return false;
    const token = Symbol();
    command.current = token;
    const epoch = generation.current;
    const snapshot = signature;
    const input = {
      profileId,
      currentStep: target,
      data: {
        ...(startAt ? { startAt } : {}),
        ...(endAt ? { endAt } : {}),
        quantities: quantityPayload,
        ...(giftCode.trim() ? { giftCode: giftCode.trim() } : {}),
        ...(addressId ? { addressId } : {}),
      },
    };
    setSaving(true);
    try {
      const response = await fetch('/api/electricity/drafts/advanced', {
        method: 'PUT',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error('Draft failed');
      const saved: unknown = await response.json();
      if (epoch !== generation.current) return false;
      if (!confirmedDraftReceipt(saved, input)) throw new Error('Draft save was not confirmed');
      savedSignature.current = snapshot;
      if (liveSignature.current !== snapshot) return false;
      if (target !== step) await wizard.go(target, step);
      else toast.success(t('electricity.order.draftSaved', locale));
      return true;
    } catch {
      if (epoch === generation.current) toast.error(t('electricity.order.draftSaveFailed', locale));
      return false;
    } finally {
      if (command.current === token) {
        command.current = null;
        setSaving(false);
      }
    }
  }

  async function openAddresses() {
    if (!(await saveDraft(false))) return;
    await navigate({ to: '/settings/addresses', search: { returnTo: '/electricity/advanced' } });
  }

  async function submit() {
    if (
      command.current ||
      completed.current ||
      loading ||
      loadError ||
      blocked ||
      !profileId ||
      !selectedAddress ||
      !quote ||
      !validPeriod ||
      !quantitiesValid ||
      quoteError ||
      !startAt ||
      !endAt
    )
      return;
    const token = Symbol();
    command.current = token;
    const epoch = generation.current;
    setSubmitting(true);
    const fingerprint = JSON.stringify({ ...previewInput, addressId, quote: quote.reviewDigest });
    if (submission.current?.fingerprint !== fingerprint) {
      submission.current = { fingerprint, key: crypto.randomUUID() };
    }
    try {
      const response = await fetch('/api/electricity/orders/advanced', {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ...previewInput,
          idempotencyKey: submission.current.key,
          expectedQuoteDigest: quote.reviewDigest,
          address: {
            provinceId: selectedAddress.provinceId,
            cityId: selectedAddress.cityId,
            fullAddress: selectedAddress.fullAddress,
            postalCode: selectedAddress.postalCode,
          },
        }),
      });
      if (epoch !== generation.current) return;
      if (response.status === 409) {
        setQuoteVersion((version) => version + 1);
        toast.error(t('electricity.order.reviewChanged', locale));
        return;
      }
      if (!response.ok) throw new Error('Order failed');
      const result = electricityOrderReceipt(await response.json());
      if (epoch !== generation.current) return;
      completed.current = true;
      await navigate({ to: '/electricity/orders/$orderId', params: { orderId: result.orderId } });
    } catch {
      if (epoch === generation.current) toast.error(t('electricity.order.submitFailed', locale));
    } finally {
      if (command.current === token) {
        command.current = null;
        setSubmitting(false);
      }
    }
  }

  if (loading) return <p role="status">{t('electricity.order.draftLoading', locale)}</p>;
  if (loadError || !profileId || !options)
    return (
      <div role="alert" className="space-y-3">
        <p>{t('electricity.order.draftLoadFailed', locale)}</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setLoading(true);
            setLoadError(false);
            if (profileId && options) setDraftAttempt((current) => current + 1);
            else setBootstrapAttempt((current) => current + 1);
          }}
        >
          {t('electricity.order.retry', locale)}
        </Button>
      </div>
    );
  if (blocked) return <div role="alert">{t('electricity.order.verificationRequired', locale)}</div>;
  const steps = [
    t('electricity.advanced.stepDates', locale),
    t('electricity.advanced.stepProducts', locale),
    t('electricity.advanced.stepPrice', locale),
    t('electricity.order.step4', locale),
    t('electricity.advanced.stepConfirm', locale),
  ];
  return (
    <div className="mx-auto max-w-4xl space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {blocker.status === 'blocked' && (
        <Suspense>
          <LeaveDialog
            working={fields.pending || saving || submitting}
            workingLabel={t(
              submitting ? 'electricity.order.submitting' : 'electricity.order.savingDraft',
              locale
            )}
            onSave={() => saveDraft(false)}
            onStay={() => blocker.reset()}
            onLeave={() => blocker.proceed()}
          />
        </Suspense>
      )}
      <header>
        <h1 className="text-2xl font-semibold">{t('electricity.advanced.title', locale)}</h1>
        <p className="text-sm text-muted-foreground">
          {t('electricity.advanced.description', locale)}
        </p>
      </header>
      <ValidatedFormWizard
        form={fields.form}
        errorId={fields.errorId}
        onPendingChange={fields.setValidationPending}
        disabled={loading || loadError || blocked || completed.current || saving || submitting}
        onInvalidStep={(target) => wizard.go(target, step)}
        fields={[
          [
            { name: 'start', label: t('electricity.advanced.start', locale) },
            { name: 'end', label: t('electricity.advanced.end', locale) },
          ],
          keys.map((key) => ({
            name: `quantities.${key}` as const,
            label:
              products.find((product) => product.systemKey === key)?.title?.[locale] ??
              t('electricity.order.quantity', locale),
          })),
          [],
          [
            { name: 'addressId', label: t('electricity.order.selectAddress', locale) },
            { name: 'giftCode', label: t('electricity.order.giftCode', locale) },
          ],
          [],
        ]}
        steps={steps}
        step={step}
        ariaLabel={t('electricity.order.steps', locale)}
        backLabel={t('electricity.order.back', locale)}
        saveLabel={t('electricity.order.saveDraft', locale)}
        nextLabel={t('electricity.order.next', locale)}
        submitLabel={t('electricity.order.submit', locale)}
        savingLabel={t('electricity.order.savingDraft', locale)}
        submittingLabel={t('electricity.order.submitting', locale)}
        saving={saving}
        submitting={submitting}
        saveDisabled={completed.current}
        nextDisabled={
          completed.current ||
          (step === 1
            ? !validPeriod
            : !quote || !validPeriod || !quantitiesValid || !!quoteError) ||
          (step === 4 && !selectedAddress)
        }
        submitDisabled={
          completed.current ||
          !quote ||
          !selectedAddress ||
          !validPeriod ||
          !quantitiesValid ||
          !!quoteError ||
          submitting
        }
        onBack={() => void saveDraft(false, step - 1)}
        onSave={() => void saveDraft(false)}
        onNext={() => saveDraft(true)}
        onSubmit={submit}
      >
        {(pending) => (
          <fieldset
            className="min-w-0"
            disabled={pending || saving || submitting || completed.current}
          >
            <legend className="sr-only">{t('electricity.order.steps', locale)}</legend>
            {step === 1 && (
              <Card className="mb-6">
                <CardContent className="space-y-4 pt-6">
                  <JalaliTimeInput
                    id="advanced-start"
                    binding={fields.bind('start')}
                    label={t('electricity.advanced.start', locale)}
                    value={start}
                    onChange={setStart}
                  />
                  <JalaliTimeInput
                    id="advanced-end"
                    binding={fields.bind('end')}
                    label={t('electricity.advanced.end', locale)}
                    value={end}
                    onChange={setEnd}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t('electricity.advanced.limits', locale)}: {options.limits.leadTimeDays} /{' '}
                    {options.limits.maxContractDuration}
                  </p>
                  {validPeriod && (
                    <p className="text-sm">
                      {t('electricity.advanced.duration', locale)}:{' '}
                      {Math.floor(
                        (new Date(endAt!).getTime() - new Date(startAt!).getTime()) / 3_600_000
                      )}{' '}
                      h{' '}
                      {Math.floor(
                        (new Date(endAt!).getTime() - new Date(startAt!).getTime()) / 60_000
                      ) % 60}{' '}
                      min
                    </p>
                  )}
                  {!validPeriod && (
                    <p role="alert" className="text-sm text-destructive">
                      {t('electricity.advanced.invalidPeriod', locale)}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
            {step === 2 && (
              <Card className="mb-6">
                <CardContent className="space-y-4 pt-6">
                  {products.map((product) => {
                    const locked = product.systemKey === 'green' && options.mandatoryGreenEnabled;
                    const unavailable =
                      !product.orderable || product.status !== 'active' || !product.price;
                    const amount = quantities[product.systemKey];
                    return (
                      <div key={product.systemKey} className="rounded-lg border p-4">
                        <label
                          htmlFor={`advanced-${product.systemKey}`}
                          className="block font-medium"
                        >
                          {product.title?.[locale] ??
                            t(`electricity.catalogue.${product.systemKey}`, locale)}
                        </label>
                        <p className="text-xs text-muted-foreground">
                          {product.price ? numbers.money(product.price) : '—'} / kWh ·
                          {product.limits.minKwh}–
                          {product.limits.maxKwh === '0' ? '∞' : product.limits.maxKwh} kWh
                        </p>
                        <input
                          id={`advanced-${product.systemKey}`}
                          {...(!locked ? fields.bind(`quantities.${product.systemKey}`) : {})}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          className={`${fieldClass} mt-2`}
                          value={
                            locked
                              ? (quote?.lines.find((line) => line.systemKey === 'green')
                                  ?.quantityKwh ?? '0')
                              : amount
                          }
                          disabled={locked || unavailable}
                          aria-readonly={locked}
                          onChange={(event) => {
                            if (/^\d{0,19}$/.test(event.target.value))
                              setQuantities((current) => ({
                                ...current,
                                [product.systemKey]: event.target.value,
                              }));
                          }}
                        />
                        {locked && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('electricity.advanced.greenDerived', locale)}
                          </p>
                        )}
                        {unavailable && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('electricity.catalogue.unavailable', locale)}
                          </p>
                        )}
                        {quote?.lines.find((line) => line.systemKey === product.systemKey) && (
                          <p className="mt-1 text-sm">
                            {numbers.money(
                              quote.lines.find((line) => line.systemKey === product.systemKey)!
                                .subtotalIrR
                            )}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {quoteError && <ElectricityQuoteErrorNotice message={quoteError} />}
                </CardContent>
              </Card>
            )}
            {step === 4 && (
              <Card className="mb-6">
                <CardContent className="space-y-3 pt-6">
                  <h2 className="font-semibold">{t('electricity.order.selectAddress', locale)}</h2>
                  {addresses.map((address) => (
                    <label key={address.id} className="flex gap-3 rounded-lg border p-3">
                      <input
                        type="radio"
                        {...fields.bind('addressId')}
                        value={address.id}
                        checked={addressId === address.id}
                        onChange={() => setAddressId(address.id)}
                      />
                      <span>
                        {address.fullAddress} · {address.postalCode}
                      </span>
                    </label>
                  ))}
                  <Button
                    type="button"
                    variant="link"
                    className="px-0 text-sm"
                    disabled={saving}
                    onClick={() => void openAddresses()}
                  >
                    {t('electricity.order.addAddress', locale)}
                  </Button>
                </CardContent>
              </Card>
            )}
            {(step === 3 || step === 4 || step === 5) && (
              <Card className="mb-6">
                <CardContent className="space-y-4 pt-6">
                  {step === 4 && (
                    <label className="block text-sm">
                      {t('electricity.order.giftCode', locale)}
                      <input
                        className={fieldClass}
                        {...fields.bind('giftCode')}
                        value={giftCode}
                        maxLength={100}
                        onChange={(event) => setGiftCode(event.target.value)}
                      />
                    </label>
                  )}
                  {quoteError && <ElectricityQuoteErrorNotice message={quoteError} />}
                  {!quote ? (
                    !quoteError && (
                      <p role={validPeriod && quantitiesValid ? 'status' : 'alert'}>
                        {validPeriod
                          ? quantitiesValid
                            ? t('electricity.order.previewLoading', locale)
                            : t('electricity.order.quantityInvalid', locale)
                          : t('electricity.advanced.invalidPeriod', locale)}
                      </p>
                    )
                  ) : (
                    <>
                      {step === 5 ? (
                        <StepReviewPage
                          title={t('electricity.order.review', locale)}
                          editLabel={t('electricity.order.edit', locale)}
                          disabled={saving || submitting || completed.current}
                          onEdit={(target) => void saveDraft(false, target)}
                          sections={[
                            {
                              id: 'period',
                              title: steps[0]!,
                              step: 1,
                              rows: [
                                {
                                  label: t('electricity.order.period.selection', locale),
                                  value: `${start} – ${end}`,
                                },
                              ],
                            },
                            {
                              id: 'products',
                              title: steps[1]!,
                              step: 2,
                              rows: [
                                ...quote.lines.map((line) => ({
                                  label: t(`electricity.catalogue.${line.systemKey}`, locale),
                                  value: `${numbers.irrDigits(line.quantityKwh)} kWh`,
                                })),
                                {
                                  label: t('electricity.order.quantity', locale),
                                  value: `${numbers.irrDigits(quote.totalKwh)} kWh`,
                                },
                                {
                                  label: t('electricity.order.averagePower', locale),
                                  value: `${numbers.irrDigits(quote.averagePowerKw)} kW`,
                                },
                              ],
                              content: quote.greenRuleApplies ? (
                                <p className="text-sm">
                                  {t('electricity.order.mandatoryGreen', locale)}
                                </p>
                              ) : null,
                            },
                            {
                              id: 'price',
                              title: steps[2]!,
                              step: 3,
                              content: (
                                <ElectricityFinancialReviewSummary
                                  title={t('electricity.order.total', locale)}
                                  quote={quote}
                                  locale={locale}
                                  formatMoney={numbers.money}
                                  formatQuantity={numbers.irrDigits}
                                />
                              ),
                            },
                            {
                              id: 'gift',
                              title: t('electricity.order.giftCode', locale),
                              step: 4,
                              rows: [
                                {
                                  label: t('electricity.order.giftCode', locale),
                                  value: giftCode.trim() || '—',
                                },
                              ],
                            },
                            {
                              id: 'address',
                              title: t('electricity.order.deliveryAddress', locale),
                              step: 4,
                              rows: [
                                {
                                  label: t('electricity.order.deliveryAddress', locale),
                                  value: selectedAddress?.fullAddress,
                                },
                                {
                                  label: t('electricity.order.postalCode', locale),
                                  value: selectedAddress?.postalCode,
                                },
                              ],
                            },
                            {
                              id: 'profile',
                              title: t('electricity.order.profile', locale),
                              rows: [
                                {
                                  label: t('electricity.order.profile', locale),
                                  value: profileName || profileId,
                                },
                              ],
                            },
                            {
                              id: 'terms',
                              title: t('electricity.order.contractPreview', locale),
                              content: (
                                <>
                                  <ElectricityContractTerms template={quote.contractTemplate} />
                                  <h4 className="font-medium">
                                    {t('electricity.order.cancellationRules', locale)}
                                  </h4>
                                  <p className="text-sm">
                                    {t('electricity.order.cancellationRulesText', locale)}
                                  </p>
                                  <p className="text-sm">
                                    {t('electricity.order.paymentAfterSubmit', locale)}
                                  </p>
                                </>
                              ),
                            },
                          ]}
                        />
                      ) : (
                        <>
                          <p>
                            {t('electricity.order.period.selection', locale)}: {start} – {end}
                          </p>
                          <p>
                            {t('electricity.order.quantity', locale)}:{' '}
                            {numbers.irrDigits(quote.totalKwh)} kWh ·{' '}
                            {t('electricity.order.averagePower', locale)}:{' '}
                            {numbers.irrDigits(quote.averagePowerKw)} kW · {quote.durationHours} h
                          </p>
                          {quote.greenRuleApplies && (
                            <p>{t('electricity.order.mandatoryGreen', locale)}</p>
                          )}
                          <ElectricityFinancialReviewSummary
                            title={t('electricity.order.total', locale)}
                            quote={quote}
                            locale={locale}
                            formatMoney={numbers.money}
                            formatQuantity={numbers.irrDigits}
                          />
                        </>
                      )}
                      <p>
                        {t('electricity.order.walletBalance', locale)}:{' '}
                        {numbers.money(quote.walletBalanceIrR)}
                      </p>
                      {step === 5 && (
                        <WalletFundingPrompt
                          balance={quote.walletBalanceIrR}
                          total={quote.totalIrR}
                        />
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </fieldset>
        )}
      </ValidatedFormWizard>
    </div>
  );
}
