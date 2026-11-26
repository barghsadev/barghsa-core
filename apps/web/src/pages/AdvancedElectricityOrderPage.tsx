import { CheckoutGiftCode } from '../components/CheckoutGiftCode.js';
import { electricityDraftPath } from '../lib/electricity-draft.js';
import { takeSavedOrderAddress } from '../lib/order-address-handoff.js';
import { ConfirmationFields } from '@barghsa/ui';
import { useRiskConfirmation } from '../hooks/useRiskConfirmation.js';
import { commercialFetch as fetch } from '../lib/commercial-fetch.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { LoadingStatus, Button, Card, CardContent, DateTimePicker, Input } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { toast } from '../lib/toast-api.js';
import { AdvancedElectricityReview } from '../components/AdvancedElectricityReview.js';
import {
  wizardActionSurface,
  wizardChoiceCard,
  wizardChoiceRadio,
} from '../components/FormWizard.js';
import { ValidatedFormWizard } from '../components/ValidatedFormWizard.js';
import { useWizardForm, type WizardFieldBinding } from '../hooks/useWizardForm.js';
import { z } from 'zod';
import { WalletFundingPrompt } from '../components/WalletFundingPrompt.js';
import { ElectricityQuoteErrorNotice } from '../components/ElectricityQuoteErrorNotice.js';
import { ElectricityFinancialReviewSummary } from '../components/ElectricityFinancialReviewSummary.js';
import type { ElectricityContractTermsSnapshot } from '../components/ElectricityContractTerms.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useWizardStep } from '../hooks/useWizardStep.js';
import { electricityOrderReceipt } from '../lib/form-receipt.js';
import {
  defaultIntakeAddressId,
  readIntakeAddresses,
  type IntakeAddress,
} from '../lib/service-intake-records.js';
import {
  isElectricityCatalogue,
  type ElectricityCatalogueProduct,
} from '../lib/electricity-catalogue.js';
import {
  ElectricityDraftRecovery,
  useElectricityDraftPersistence,
} from './electricity-draft-persistence.js';
import { useReviewedSubmission } from '../hooks/useReviewedSubmission.js';
import { SubmissionRecovery } from '../components/SubmissionRecovery.js';
import { formatJalaliDateTime, parseJalaliDateTime } from '../lib/jalali-date-time.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import {
  ElectricityQuotePreviewError,
  electricityQuoteError,
} from '../lib/electricity-quote-error.js';

type Key = 'thermal' | 'green' | 'free_market' | 'energy_saving';
const keys: Key[] = ['thermal', 'green', 'free_market', 'energy_saving'];
// Existing links and server drafts may still refer to the former price-only stage.
const advancePastPrice = (step: number) => (step === 3 ? 4 : step);
export type AdvancedElectricityQuote = {
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
type Quote = AdvancedElectricityQuote;
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
      triggerProps={{ ...binding, 'aria-required': true }}
      {...(binding ? { onBlur: binding.onBlur } : {})}
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
  const [products, setProducts] = useState<ElectricityCatalogueProduct[]>([]);
  const [addresses, setAddresses] = useState<IntakeAddress[]>([]);
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
  const [quoteVersion, setQuoteVersion] = useState(0);
  const [quoteError, setQuoteError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [draftAttempt, setDraftAttempt] = useState(0);
  const drafts = useElectricityDraftPersistence('advanced');
  const { reset: resetDraft, retire: retireDraft, readRevision } = drafts;
  const saving = drafts.working;
  const [submitting, setSubmitting] = useState(false);
  const wizard = useWizardStep('/electricity/orders/new/advanced', 5, advancePastPrice);
  const { step } = wizard;
  const command = useRef<symbol | null>(null);
  const orderSubmission = useReviewedSubmission(
    '/api/electricity/orders/advanced',
    profileId,
    electricityOrderReceipt,
    { addIdempotencyKey: true }
  );
  const orderUnconfirmed = orderSubmission.unconfirmed;
  const held = orderUnconfirmed || !!drafts.recovery;
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
      (hasUnsavedChanges() ||
        held ||
        !!command.current ||
        !!drafts.active.current ||
        fields.isPending()),
    enableBeforeUnload: () =>
      !completed.current &&
      (hasUnsavedChanges() ||
        held ||
        !!command.current ||
        !!drafts.active.current ||
        fields.isPending()),
    withResolver: true,
  });
  const activeBlocker = useRef(blocker);
  activeBlocker.current = blocker;
  const selectedAddress = addresses.find((address) => address.id === addressId);
  const startAt = useMemo(() => parseJalaliDateTime(start), [start]);
  const endAt = useMemo(() => parseJalaliDateTime(end), [end]);
  const deliveryTime = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        calendar: 'persian',
        timeZone: 'Asia/Tehran',
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale]
  );
  const periodRows = [
    { label: t('electricity.advanced.start', locale), date: startAt },
    { label: t('electricity.advanced.end', locale), date: endAt },
  ].map(({ label, date }) => ({
    label,
    value: date ? <time dateTime={date}>{deliveryTime.format(new Date(date))}</time> : '—',
  }));
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
  const periodMinutes =
    validPeriod && startAt && endAt
      ? Math.floor((Date.parse(endAt) - Date.parse(startAt)) / 60_000)
      : null;
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
  const [quoted, setQuoted] = useState<{ input: typeof previewInput; price: Quote } | null>(null);
  const quote = quoted?.input === previewInput ? quoted.price : null;
  const quoteStatus = quote ? null : quoteError ? (
    <ElectricityQuoteErrorNotice
      message={quoteError}
      onRetry={() => setQuoteVersion((version) => version + 1)}
    />
  ) : (
    <p role={validPeriod && quantitiesValid ? 'status' : 'alert'}>
      {validPeriod
        ? quantitiesValid
          ? t('electricity.order.previewLoading', locale)
          : t('electricity.order.quantityInvalid', locale)
        : t('electricity.advanced.invalidPeriod', locale)}
    </p>
  );

  useEffect(() => {
    const abort = new AbortController();
    void readWithDeadline(abort.signal, async (signal) => {
      const [profile, catalogue, settings] = await Promise.all([
        fetch('/api/profiles/verification-status', { credentials: 'include', signal }),
        fetch('/api/products/electricity', { credentials: 'include', signal }),
        fetch('/api/electricity/periods/advanced', { credentials: 'include', signal }),
      ]);
      if (!profile.ok || !catalogue.ok || !settings.ok) throw new Error('Unavailable');
      return Promise.all([profile.json(), catalogue.json(), settings.json()]);
    })
      .then(([status, items, limits]) => {
        if (
          !status.activeProfileId ||
          !isElectricityCatalogue(items) ||
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
    resetDraft();
    setSubmitting(false);
    setLoading(true);
    void readWithDeadline(abort.signal, async (signal): Promise<[unknown, Draft]> => {
      const [addresses, draft] = await Promise.all([
        fetch(`/api/profiles/${profileId}/addresses`, { credentials: 'include', signal }),
        fetch(electricityDraftPath('advanced', profileId), {
          credentials: 'include',
          signal,
        }),
      ]);
      if (!addresses.ok || !draft.ok) throw new Error('Unavailable');
      return Promise.all([addresses.json(), draft.json()]);
    })
      .then(([addressData, draft]) => {
        if (abort.signal.aborted) return;
        const addresses = readIntakeAddresses(addressData, profileId);
        if (
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
        readRevision(draft);
        setAddresses(addresses);
        const restoredAddress = draft.data?.addressId ?? defaultIntakeAddressId(addresses);
        const restoredStart = draft.data?.startAt
          ? formatJalaliDateTime(new Date(draft.data.startAt))
          : start;
        const restoredEnd = draft.data?.endAt
          ? formatJalaliDateTime(new Date(draft.data.endAt))
          : end;
        const restoredQuantities = { ...emptyQuantities, ...draft.data?.quantities };
        const restoredGift = draft.data?.giftCode ?? '';
        setAddressId(takeSavedOrderAddress(profileId, addresses) ?? restoredAddress);
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
      retireDraft();
      command.current = null;
      if (generation.current === epoch) generation.current++;
    };
  }, [profileId, draftAttempt, readRevision, resetDraft, retireDraft]);

  useEffect(() => {
    setQuoted(null);
    setQuoteError('');
    if (!profileId || blocked || !validPeriod || !quantitiesValid || !options) return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      setQuoteError('');
      void readWithDeadline(abort.signal, async (signal) => {
        const response = await fetch('/api/electricity/preview/advanced', {
          method: 'POST',
          credentials: 'include',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(previewInput),
        });
        if (!response.ok)
          throw new ElectricityQuotePreviewError(await electricityQuoteError(response, locale));
        return response.json() as Promise<Quote>;
      })
        .then((value) => {
          if (!abort.signal.aborted) setQuoted({ input: previewInput, price: value });
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

  async function saveDraft(
    next: boolean,
    target = next ? advancePastPrice(step + 1) : step,
    leave = false
  ) {
    if (next && step === 4 && !selectedAddress) return false;
    if (
      command.current ||
      held ||
      drafts.active.current ||
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
    const saved = await drafts.save(
      input,
      async () => {
        if (epoch !== generation.current) return false;
        savedSignature.current = snapshot;
        if (liveSignature.current !== snapshot) return false;
        if (target !== step) await wizard.go(target, step);
        else toast.success(t('electricity.order.draftSaved', locale));
        return true;
      },
      leave
    );
    if (!saved && epoch === generation.current && !drafts.unresolved.current)
      toast.error(t('electricity.order.draftSaveFailed', locale));
    return saved;
  }

  async function openAddresses() {
    if (held || drafts.active.current) return;
    if (savedSignature.current !== liveSignature.current && !(await saveDraft(false))) return;
    await navigate({
      to: '/settings/addresses/new',
      search: { returnTo: '/electricity/orders/new/advanced' },
    });
  }

  const financialGate = useRiskConfirmation(
    JSON.stringify([profileId, addressId, quote?.reviewDigest]),
    locale,
    'financial'
  );
  async function sendOrder(input?: object) {
    if (
      command.current ||
      drafts.active.current ||
      drafts.recovery ||
      completed.current ||
      loading ||
      loadError ||
      blocked ||
      !profileId
    )
      return;
    const token = Symbol();
    command.current = token;
    const epoch = generation.current;
    setSubmitting(true);
    const current = () => epoch === generation.current;
    try {
      const result = await orderSubmission.send(input, current);
      if (!current()) return;
      if (result.status === 'confirmed') {
        completed.current = true;
        toast.success(t('electricity.order.success.create', locale));
        await navigate({
          to: '/electricity/orders/$orderId',
          params: { orderId: result.receipt.orderId },
        }).catch(() => {});
      } else if (result.status === 'conflict') {
        setQuoteVersion((version) => version + 1);
        toast.error(t('electricity.order.reviewChanged', locale));
      } else if (result.status === 'unconfirmed') {
        toast.error(t('electricity.order.unconfirmed', locale));
      } else if (result.status === 'rejected') {
        toast.error(t('electricity.order.error.create', locale));
      }
    } finally {
      if (command.current === token) {
        command.current = null;
        setSubmitting(false);
      }
    }
  }

  async function submit() {
    if (!financialGate.allowed || held) return;
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
    await sendOrder({
      ...previewInput,
      expectedQuoteDigest: quote.reviewDigest,
      address: {
        provinceId: selectedAddress.provinceId,
        cityId: selectedAddress.cityId,
        fullAddress: selectedAddress.fullAddress,
        postalCode: selectedAddress.postalCode,
      },
    });
  }

  const title = t('electricity.advanced.title', locale);
  const statusHeading = <h1 className="sr-only">{title}</h1>;
  if (loading)
    return (
      <>
        {statusHeading}
        <LoadingStatus>{t('electricity.order.draftLoading', locale)}</LoadingStatus>
      </>
    );
  if (loadError || !profileId || !options)
    return (
      <>
        {statusHeading}
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
      </>
    );
  if (blocked)
    return (
      <>
        {statusHeading}
        <div role="alert">{t('electricity.order.verificationRequired', locale)}</div>
      </>
    );
  const steps = [
    t('electricity.advanced.stepDates', locale),
    t('electricity.advanced.stepProducts', locale),
    t('electricity.order.step4', locale),
    t('electricity.advanced.stepConfirm', locale),
  ];
  const draftRecovery = drafts.recovery && (
    <ElectricityDraftRecovery
      phase={drafts.recovery}
      locale={locale}
      working={drafts.working}
      discardRetry={drafts.discardRetry}
      onAction={async () => {
        if (drafts.recovery === 'stale') {
          if (blocker.status === 'blocked') blocker.reset();
          setDraftAttempt((value) => value + 1);
        } else if (await drafts.recover()) {
          const latest = activeBlocker.current;
          if (latest.status === 'blocked') latest.proceed();
        }
      }}
    />
  );
  return (
    <div className="mx-auto max-w-4xl space-y-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {blocker.status === 'blocked' && (
        <Suspense>
          <LeaveDialog
            working={fields.pending || saving || submitting}
            workingLabel={t(
              submitting ? 'electricity.order.submitting' : 'electricity.order.savingDraft',
              locale
            )}
            saveDisabled={held}
            errorMessage={orderUnconfirmed ? t('electricity.order.unconfirmed', locale) : undefined}
            onSave={() => saveDraft(false, step, true)}
            onStay={() => blocker.reset()}
            recovery={draftRecovery}
            onDiscardSaved={
              held
                ? undefined
                : async () =>
                    !!profileId &&
                    !command.current &&
                    !completed.current &&
                    drafts.discard(profileId)
            }
            onLeave={() => blocker.proceed()}
          />
        </Suspense>
      )}
      <header className="space-y-1.5" data-toast-anchor>
        <Link
          to="/electricity"
          className="inline-flex min-h-9 items-center text-sm font-medium text-primary hover:underline"
        >
          {t('electricity.catalogue.title', locale)}
        </Link>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {step === 1 && (
          <p className="text-sm text-muted-foreground">
            {t('electricity.advanced.description', locale)}
          </p>
        )}
      </header>
      {blocker.status !== 'blocked' && draftRecovery}
      {orderUnconfirmed && (
        <SubmissionRecovery busy={submitting} onRetry={() => void sendOrder()} />
      )}
      <ValidatedFormWizard
        form={fields.form}
        errorId={fields.errorId}
        onPendingChange={fields.setValidationPending}
        disabled={
          held || loading || loadError || blocked || completed.current || saving || submitting
        }
        onInvalidStep={(target) => wizard.go(target < 3 ? target : target + 1, step)}
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
          [
            { name: 'addressId', label: t('electricity.order.selectAddress', locale) },
            { name: 'giftCode', label: t('electricity.order.giftCode', locale) },
          ],
          [],
        ]}
        steps={steps}
        step={step < 3 ? step : step - 1}
        compactProgress
        actionsClassName={
          step === 2 || step === 4
            ? `${wizardActionSurface} max-lg:sticky max-lg:bottom-0 max-lg:z-20 max-lg:pb-[max(0.5rem,env(safe-area-inset-bottom))] [&>button]:min-h-11`
            : wizardActionSurface
        }
        actionSummary={
          (step === 2 || step === 4) && (
            <div
              role={step === 2 || quote ? 'status' : undefined}
              className="w-full text-sm lg:hidden empty:hidden"
            >
              {quote ? (
                <p className="flex flex-wrap items-baseline justify-between gap-x-2 font-semibold">
                  {t('electricity.order.total', locale)}
                  <bdi className="min-w-0 wrap-anywhere">{numbers.money(quote.totalIrR)}</bdi>
                </p>
              ) : validPeriod && quantitiesValid && !quoteError ? (
                <p className="text-muted-foreground" aria-hidden={step === 4 || undefined}>
                  {t('electricity.order.previewLoading', locale)}
                </p>
              ) : null}
            </div>
          )
        }
        ariaLabel={t('electricity.order.steps', locale)}
        backLabel={t('electricity.order.back', locale)}
        saveLabel={t('electricity.order.saveDraft', locale)}
        nextLabel={t('electricity.order.next', locale)}
        submitLabel={t('electricity.order.submit', locale)}
        savingLabel={t('electricity.order.savingDraft', locale)}
        submittingLabel={t('electricity.order.submitting', locale)}
        saving={saving}
        submitting={submitting}
        backDisabled={held}
        saveDisabled={held || completed.current}
        nextDisabled={
          held ||
          completed.current ||
          (step === 1
            ? !validPeriod
            : !quote || !validPeriod || !quantitiesValid || !!quoteError) ||
          (step === 4 && !selectedAddress)
        }
        submitDisabled={
          held ||
          !financialGate.allowed ||
          completed.current ||
          !quote ||
          !selectedAddress ||
          !validPeriod ||
          !quantitiesValid ||
          !!quoteError ||
          submitting
        }
        onBack={() => void saveDraft(false, step === 4 ? 2 : step - 1)}
        onSave={() => void saveDraft(false)}
        onNext={() => saveDraft(true)}
        onSubmit={submit}
      >
        {(pending) => (
          <fieldset
            className="min-w-0"
            disabled={held || pending || saving || submitting || completed.current}
          >
            <legend className="sr-only">{t('electricity.order.steps', locale)}</legend>
            {step === 1 && (
              <Card size="sm" className="mb-3">
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
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
                  </div>
                  <dl className="space-y-1.5 rounded-lg bg-muted/45 px-3 py-2 text-xs">
                    <div className="flex flex-wrap justify-between gap-x-3">
                      <dt className="text-muted-foreground">
                        {t('electricity.advanced.leadTime', locale)}
                      </dt>
                      <dd>
                        {t('electricity.advanced.days', locale).replace(
                          '{count}',
                          numbers.number(options.limits.leadTimeDays)
                        )}
                      </dd>
                    </div>
                    <div className="flex flex-wrap justify-between gap-x-3">
                      <dt className="text-muted-foreground">
                        {t('electricity.advanced.maximumDuration', locale)}
                      </dt>
                      <dd>
                        {t('electricity.advanced.jalaliMonths', locale).replace(
                          '{count}',
                          numbers.number(options.limits.maxContractDuration)
                        )}
                      </dd>
                    </div>
                    {periodMinutes !== null && (
                      <div className="flex flex-wrap justify-between gap-x-3 border-t pt-1.5">
                        <dt className="font-medium">
                          {t('electricity.advanced.duration', locale)}
                        </dt>
                        <dd>
                          {t('electricity.advanced.hoursMinutes', locale)
                            .replace('{hours}', numbers.number(Math.floor(periodMinutes / 60)))
                            .replace('{minutes}', numbers.number(periodMinutes % 60))}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {!validPeriod && (
                    <p role="alert" className="text-sm text-destructive">
                      {t('electricity.advanced.invalidPeriod', locale)}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
            {step === 2 && (
              <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(15rem,1fr)]">
                <Card size="sm">
                  <CardContent>
                    <div className="space-y-1 pb-2">
                      <h2 className="text-base font-semibold">
                        {t('electricity.advanced.productQuantities', locale)}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {t('electricity.advanced.productQuantitiesHint', locale)}
                      </p>
                    </div>
                    <div className="divide-y divide-border">
                      {products.map((product) => {
                        const key = product.systemKey;
                        const locked = key === 'green' && options.mandatoryGreenEnabled;
                        const unavailable =
                          !product.orderable || product.status !== 'active' || !product.price;
                        const amount = quantities[key];
                        const showQuantity = !unavailable || (!!amount && amount !== '0');
                        const title =
                          product.title?.[locale] ?? t(`electricity.catalogue.${key}`, locale);
                        const line = quote?.lines.find((item) => item.systemKey === key);
                        const binding = locked ? undefined : fields.bind(`quantities.${key}`);
                        const detailsId = `advanced-${key}-details`;
                        return (
                          <div
                            key={key}
                            className="grid grid-cols-[minmax(0,1fr)_minmax(5.5rem,clamp(6rem,35%,9rem))] items-start gap-2 py-3 sm:gap-4"
                          >
                            <div className="min-w-0 space-y-1">
                              {showQuantity ? (
                                <label
                                  htmlFor={`advanced-${key}`}
                                  className="block text-sm font-medium"
                                >
                                  {title}
                                </label>
                              ) : (
                                <p className="text-sm font-medium">{title}</p>
                              )}
                              <div
                                id={detailsId}
                                className="space-y-0.5 text-xs text-muted-foreground"
                              >
                                {unavailable ? (
                                  <p>{t('electricity.catalogue.unavailable', locale)}</p>
                                ) : (
                                  <>
                                    <p>
                                      <bdi>{numbers.money(product.price!)}</bdi>{' '}
                                      <bdi dir="ltr">/ kWh</bdi>
                                    </p>
                                    {locked ? (
                                      <p>{t('electricity.advanced.greenDerived', locale)}</p>
                                    ) : (
                                      <p>
                                        <bdi dir="ltr">
                                          {numbers.irrDigits(product.limits.minKwh)}–
                                          {product.limits.maxKwh === '0'
                                            ? '∞'
                                            : numbers.irrDigits(product.limits.maxKwh)}{' '}
                                          kWh
                                        </bdi>
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                            {showQuantity && (
                              <div className="min-w-0 space-y-1">
                                <Input
                                  id={`advanced-${key}`}
                                  {...binding}
                                  aria-describedby={[detailsId, binding?.['aria-describedby']]
                                    .filter(Boolean)
                                    .join(' ')}
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  dir="ltr"
                                  className="tabular-nums"
                                  value={locked ? (line?.quantityKwh ?? '0') : amount}
                                  disabled={locked || unavailable}
                                  aria-readonly={locked}
                                  onChange={(event) => {
                                    const next = normalizeProfileDigits(event.target.value);
                                    if (/^\d{0,19}$/.test(next))
                                      setQuantities((current) => ({ ...current, [key]: next }));
                                  }}
                                />
                                {line && (
                                  <p className="text-end text-xs tabular-nums wrap-anywhere">
                                    <bdi>{numbers.money(line.subtotalIrR)}</bdi>
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
                <aside
                  aria-labelledby="advanced-quote-title"
                  className={quoteError ? 'min-w-0' : 'hidden min-w-0 lg:block'}
                >
                  <Card size="sm" className="bg-primary/5 ring-primary/20">
                    <CardContent className="space-y-2">
                      <h2 id="advanced-quote-title" className="text-base font-semibold">
                        {t('electricity.advanced.stepPrice', locale)}
                      </h2>
                      {quoteError ? (
                        <ElectricityQuoteErrorNotice
                          message={quoteError}
                          onRetry={() => setQuoteVersion((version) => version + 1)}
                        />
                      ) : (
                        <div role="status" className="space-y-1">
                          {quote ? (
                            <>
                              <p className="text-xs text-muted-foreground">
                                {t('electricity.order.total', locale)}
                              </p>
                              <p className="text-2xl font-semibold tabular-nums wrap-anywhere">
                                <bdi>{numbers.money(quote.totalIrR)}</bdi>
                              </p>
                              <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-x-2 gap-y-1 border-t pt-2 text-xs wrap-anywhere">
                                <dt className="text-muted-foreground">
                                  {t('electricity.order.quantity', locale)}
                                </dt>
                                <dd className="text-end">
                                  <bdi>{numbers.irrDigits(quote.totalKwh)}</bdi>
                                </dd>
                                <dt className="text-muted-foreground">
                                  {t('electricity.order.vat', locale)}
                                </dt>
                                <dd className="text-end">
                                  <bdi>{numbers.money(quote.vatIrR)}</bdi>
                                </dd>
                                {quote.discountIrR !== '0' && (
                                  <>
                                    <dt className="text-muted-foreground">
                                      {t('electricity.order.discount', locale)}
                                    </dt>
                                    <dd className="text-end">
                                      <bdi>{numbers.money(quote.discountIrR)}</bdi>
                                    </dd>
                                  </>
                                )}
                              </dl>
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              {t(
                                validPeriod && quantitiesValid
                                  ? 'electricity.order.previewLoading'
                                  : 'electricity.advanced.quotePrompt',
                                locale
                              )}
                            </p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </aside>
              </div>
            )}
            {step === 4 && (
              <Card size="sm" className="mb-3">
                <CardContent className="space-y-3">
                  <h2 id="advanced-address-title" className="font-semibold">
                    {t('electricity.order.selectAddress', locale)}
                  </h2>
                  {addresses.length > 0 ? (
                    <div
                      role="radiogroup"
                      aria-labelledby="advanced-address-title"
                      aria-required="true"
                      className="space-y-2"
                    >
                      {addresses.map((address) => (
                        <label key={address.id} className={wizardChoiceCard}>
                          <input
                            type="radio"
                            {...fields.bind('addressId')}
                            className={wizardChoiceRadio}
                            value={address.id}
                            checked={addressId === address.id}
                            onChange={() => setAddressId(address.id)}
                          />
                          <span className="min-w-0 space-y-1 text-sm">
                            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <span className="font-medium wrap-anywhere">
                                {address.fullAddress}
                              </span>
                              {address.mainAddress && (
                                <span className="rounded-md bg-muted px-1.5 text-xs text-muted-foreground">
                                  {t('electricity.order.mainAddress', locale)}
                                </span>
                              )}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {t('electricity.order.postalCode', locale)}{' '}
                              <bdi>{address.postalCode}</bdi>
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      {t('electricity.order.noAddresses', locale)}
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={() => void openAddresses()}
                  >
                    {t('electricity.order.addAddress', locale)}
                  </Button>
                </CardContent>
              </Card>
            )}
            {(step === 4 || step === 5) && (
              <Card size="sm" className="mb-3">
                <CardContent className="space-y-3">
                  {step === 4 && (
                    <CheckoutGiftCode
                      inputId="advanced-gift"
                      summary={t('electricity.order.giftCode', locale)}
                      label={t('electricity.order.giftCode', locale)}
                      field={fields.bind('giftCode')}
                      value={giftCode}
                      maxLength={100}
                      onChange={setGiftCode}
                    />
                  )}
                  {step === 5 ? (
                    <AdvancedElectricityReview
                      quote={quote}
                      quantities={quantityPayload}
                      quantitiesValid={quantitiesValid}
                      periodRows={periodRows}
                      address={selectedAddress}
                      giftCode={giftCode.trim()}
                      profile={profileName || profileId}
                      quoteStatus={quoteStatus}
                      editDisabled={saving || submitting || completed.current}
                      onEdit={(target) => void saveDraft(false, target)}
                    />
                  ) : quote ? (
                    <>
                      <ElectricityFinancialReviewSummary quote={quote} locale={locale} expandable />
                      <dl className="grid gap-x-4 gap-y-2 text-sm min-[375px]:grid-cols-2">
                        {periodRows.map(({ label, value }) => (
                          <div key={label}>
                            <dt className="text-xs text-muted-foreground">{label}</dt>
                            <dd className="font-medium">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                        <span>
                          {t('electricity.order.quantity', locale)}{' '}
                          <bdi>{numbers.irrDigits(quote.totalKwh)} kWh</bdi>
                        </span>
                        <span>
                          {t('electricity.order.averagePower', locale)}{' '}
                          <bdi dir="ltr">{quote.averagePowerKw} kW</bdi>
                        </span>
                        <bdi dir="ltr">{quote.durationHours} h</bdi>
                      </p>
                      {quote.greenRuleApplies && (
                        <p>{t('electricity.order.mandatoryGreen', locale)}</p>
                      )}
                    </>
                  ) : (
                    quoteStatus
                  )}
                  {quote && (
                    <p className="text-sm">
                      {t('electricity.order.walletBalance', locale)}:{' '}
                      {numbers.money(quote.walletBalanceIrR)}
                    </p>
                  )}
                  {step === 5 && quote && (
                    <WalletFundingPrompt balance={quote.walletBalanceIrR} total={quote.totalIrR} />
                  )}
                </CardContent>
              </Card>
            )}
            {step === 5 && <ConfirmationFields gate={financialGate} disabled={submitting} />}
          </fieldset>
        )}
      </ValidatedFormWizard>
    </div>
  );
}
