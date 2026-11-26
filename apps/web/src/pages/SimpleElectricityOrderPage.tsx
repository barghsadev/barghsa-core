import { CheckoutGiftCode } from '../components/CheckoutGiftCode.js';
import { electricityDraftPath } from '../lib/electricity-draft.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { serviceFeedback } from '@barghsa/i18n/service-feedback';
import { simpleElectricityOrderText } from '@barghsa/i18n/simple-electricity-order';
import { ConfirmationFields } from '@barghsa/ui';
import { NoDeadEndBanner } from '@barghsa/ui';
import { useRiskConfirmation } from '../hooks/useRiskConfirmation.js';
import { Skeleton } from '@barghsa/ui';
import { useOwnedIntakeRead } from '../hooks/useOwnedIntakeRead.js';
import { queryKeys } from '../lib/query-keys.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { commercialFetch as fetch } from '../lib/commercial-fetch.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { toast } from '../lib/toast-api.js';
import { t } from '@barghsa/i18n/workspace';
import { addressFormText, addressesText } from '@barghsa/i18n/addresses';
import { validatePostalCode } from '@barghsa/shared/validation';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import { MapPinIcon, PlusIcon, Loader2Icon, CheckIcon, HomeIcon, PackageIcon } from 'lucide-react';
import {
  SkeletonText,
  LoadingStatus,
  Button,
  Card,
  CardContent,
  Input,
  NativeSelect,
  Textarea,
} from '@barghsa/ui';
import { useGeographyOptions, loadGeographyOptions } from '../hooks/useGeographyOptions.js';
import { GeographyPicker } from '../components/GeographyPicker.js';
import { useWizardStep } from '../hooks/useWizardStep.js';
import { electricityOrderReceipt } from '../lib/form-receipt.js';
import {
  ElectricityDraftRecovery,
  useElectricityDraftPersistence,
} from './electricity-draft-persistence.js';
import { useReviewedSubmission } from '../hooks/useReviewedSubmission.js';
import { SubmissionRecovery } from '../components/SubmissionRecovery.js';
import { withCsrf } from '../lib/csrf.js';
import {
  defaultIntakeAddressId,
  readIntakeAddresses,
  type IntakeAddress,
} from '../lib/service-intake-records.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { ElectricityQuoteErrorNotice } from '../components/ElectricityQuoteErrorNotice.js';
import { WizardDraftAddressNotice, wizardActionSurface } from '../components/FormWizard.js';
import { ValidatedFormWizard } from '../components/ValidatedFormWizard.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { z } from 'zod';
import type { ElectricityContractTermsSnapshot } from '../components/ElectricityContractTerms.js';
import {
  ElectricityQuotePreviewError,
  electricityQuoteError,
} from '../lib/electricity-quote-error.js';

const LeaveDialog = lazy(() => import('../components/WizardLeaveDialog.js'));
const SimpleReview = lazy(() => import('../components/SimpleElectricityReview.js'));

// ─── Types ────────────────────────────────────────────────────────────

interface Product {
  id: string;
  systemKey: string;
  title: Record<string, string>;
  price: string | null;
  status: string;
  simpleOrderable: boolean;
  limits: { minKwh: string; maxKwh: string };
}

const simplePeriods = [
  'current_month',
  'next_month',
  'current_week',
  'next_week',
  'week_after_next',
] as const;
type SimplePeriod = (typeof simplePeriods)[number];
interface PeriodOption {
  key: SimplePeriod;
  start: string;
  end: string;
}
const periodsResponse = z.object({
  periods: z
    .array(
      z
        .object({ key: z.enum(simplePeriods), start: z.string(), end: z.string() })
        .refine(({ start, end }) => Date.parse(start) < Date.parse(end))
    )
    .min(1),
});
export interface PriceQuote {
  reviewDigest: string;
  contractTemplate?: ElectricityContractTermsSnapshot | null;
  periodStart: string;
  periodEnd: string;
  durationHours: string;
  totalKwh: string;
  averagePowerKw: string;
  greenRuleApplies: boolean;
  lines: Array<{
    systemKey: string;
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
}
interface BillSuggestion {
  available: boolean;
  suggestedKwh?: string;
  dataSource?: string;
  dataPeriod?: { start: string; end: string };
  dataTimestamp?: string;
  coverage?: number;
  reason?: string;
  manualEntryAllowed: boolean;
}

const periodLabels: Record<SimplePeriod, string> = {
  current_month: 'electricity.order.period.currentMonth',
  next_month: 'electricity.order.period.nextMonth',
  current_week: 'electricity.order.period.currentWeek',
  next_week: 'electricity.order.period.nextWeek',
  week_after_next: 'electricity.order.period.weekAfterNext',
};
function periodDates(option: Pick<PeriodOption, 'start' | 'end'>, locale: 'fa' | 'en') {
  const start = new Date(option.start);
  const end = new Date(new Date(option.end).getTime() - 1);
  const persian = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const gregorian = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-US', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return {
    jalali: `${persian.format(start)} – ${persian.format(end)}`,
    gregorian: `${gregorian.format(start)} – ${gregorian.format(end)}`,
  };
}

function periodChoiceDate(option: PeriodOption, locale: 'fa' | 'en') {
  const start = new Date(option.start);
  if (locale === 'fa') {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      timeZone: 'Asia/Tehran',
      month: 'long',
      year: 'numeric',
      ...(option.key.includes('week') ? { day: 'numeric' } : {}),
    }).format(start);
  }
  const end = new Date(new Date(option.end).getTime() - 1);
  const format = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    timeZone: 'Asia/Tehran',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return format.formatRange(start, end);
}

function quantityValid(value: string, product?: Product) {
  return (
    /^[1-9]\d*$/.test(value) &&
    (!product ||
      ((product.limits.minKwh === '0' || BigInt(value) >= BigInt(product.limits.minKwh)) &&
        (product.limits.maxKwh === '0' || BigInt(value) <= BigInt(product.limits.maxKwh))))
  );
}

// ─── Page Component ────────────────────────────────────────────────────

export function SimpleElectricityOrderPage() {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedSimpleElectricityOrderPage key={JSON.stringify([actor, revision])} />;
}
function OwnedSimpleElectricityOrderPage() {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readIntake = useOwnedIntakeRead(JSON.stringify([actor, revision]));
  const intakeScope = useMemo(
    () => ({
      context: 'account' as const,
      ownerId: actor ?? 'current-session',
      accountId: actor,
      revision: revision,
    }),
    [actor, revision]
  );
  const locale = useLocale();
  const time = useAccountTime(locale);
  const navigate = useNavigate();
  const numbers = useNumberFormatting(locale);

  // Profile & verification
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);
  const verificationGeneration = useRef(0);
  const [verificationError, setVerificationError] = useState(false);
  const [checking, setChecking] = useState(true);
  const [blocked, setBlocked] = useState<boolean | null>(null);

  // Products
  const [products, setProducts] = useState<Product[]>([]);
  const fields = useWizardForm(
    z
      .object({
        selectedProductId: z
          .string()
          .refine(
            (value) => products.some((product) => product.id === value),
            simpleElectricityOrderText('noProduct', locale)
          ),
        period: z
          .enum(simplePeriods)
          .refine(
            (value) => periodOptions.some((option) => option.key === value),
            t('formWizard.invalidField', locale)
          ),
        totalKwh: z.string(),
        selectedAddressId: z
          .string()
          .refine(
            (value) => addresses.some((address) => address.id === value),
            t('electricity.order.selectAddress', locale)
          ),
        giftCode: z.string(),
        appliedGiftCode: z.string(),
        addressTouched: z.boolean(),
        formProvinceId: z.string(),
        formCityId: z.string(),
        formFullAddress: z.string(),
        formPostalCode: z.string(),
      })
      .superRefine((value, context) => {
        if (
          !quantityValid(
            value.totalKwh,
            products.find((product) => product.id === value.selectedProductId)
          )
        )
          context.addIssue({
            code: 'custom',
            path: ['totalKwh'],
            message: t('electricity.order.quantityInvalid', locale),
          });
        if (value.giftCode.trim() !== value.appliedGiftCode)
          context.addIssue({
            code: 'custom',
            path: ['giftCode'],
            message: t('electricity.order.applyGiftFirst', locale),
          });
      }),
    {
      selectedProductId: '',
      period: 'current_month',
      totalKwh: '',
      selectedAddressId: '',
      giftCode: '',
      appliedGiftCode: '',
      addressTouched: false,
      formProvinceId: '',
      formCityId: '',
      formFullAddress: '',
      formPostalCode: '',
    }
  );
  const [selectedProductId, setSelectedProductId] = fields.field('selectedProductId');
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productError, setProductError] = useState(false);
  const productGeneration = useRef(0);

  // Addresses
  const [addresses, setAddresses] = useState<IntakeAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = fields.field('selectedAddressId');
  const [addressTouched, setAddressTouched] = fields.field('addressTouched');
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [addressError, setAddressError] = useState(false);
  const addressGeneration = useRef(0);
  /** City name lookup map: cityId -> { nameFa, nameEn } */
  const [cityMap, setCityMap] = useState<Record<string, { nameFa: string; nameEn: string }>>({});

  // New address form
  const [showNewAddressForm, setShowNewAddressForm] = useState(false);
  const addressHeading = useRef<HTMLHeadingElement>(null);
  const addAddressButton = useRef<HTMLButtonElement>(null);
  const [formProvinceId, setFormProvinceId] = fields.field('formProvinceId');
  const [formCityId, setFormCityId] = fields.field('formCityId');
  const provinceOptions = useGeographyOptions('/api/geography/provinces');
  const cityOptions = useGeographyOptions(
    showNewAddressForm && formProvinceId
      ? `/api/geography/provinces/${encodeURIComponent(formProvinceId)}/cities`
      : null,
    formProvinceId || undefined
  );
  const provinces = provinceOptions.options;
  const provinceError = provinceOptions.error;
  const loadingProvinces = provinceOptions.loading;
  const cities = cityOptions.options;
  const cityError = cityOptions.error;
  const loadingCities = cityOptions.loading;
  const [formFullAddress, setFormFullAddress] = fields.field('formFullAddress');
  const [formPostalCode, setFormPostalCode] = fields.field('formPostalCode');
  const [addressChecked, setAddressChecked] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const addressSaveInFlight = useRef(false);

  // Order submission
  const [submitting, setSubmitting] = useState(false);
  const orderSaveInFlight = useRef(false);
  const [orderCreated, setOrderCreated] = useState<{
    orderId: string;
    contractId: string;
    invoiceId: string;
  } | null>(null);
  const [periodOptions, setPeriodOptions] = useState<PeriodOption[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(true);
  const [periodRetry, setPeriodRetry] = useState(0);
  const periodRetryButton = useRef<HTMLButtonElement>(null);
  const restorePeriodFocus = useRef(false);
  const [period, setPeriod] = fields.field('period');
  const [totalKwh, setTotalKwh] = fields.field('totalKwh');
  const [billSuggestion, setBillSuggestion] = useState<BillSuggestion | null>(null);
  const [billSuggestionRetry, setBillSuggestionRetry] = useState(0);
  const [giftCode, setGiftCode] = fields.field('giftCode');
  const [appliedGiftCode, setAppliedGiftCode] = fields.field('appliedGiftCode');
  const [quoted, setQuote] = useState<{ key: string; data: PriceQuote } | null>(null);
  const quoteKey = JSON.stringify([
    activeProfileId,
    selectedProductId,
    period,
    totalKwh,
    appliedGiftCode,
  ]);
  const quote = quoted?.key === quoteKey ? quoted.data : null;
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [quoteVersion, setQuoteVersion] = useState(0);
  const orderSubmission = useReviewedSubmission(
    '/api/electricity/orders/simple',
    activeProfileId,
    electricityOrderReceipt,
    { addIdempotencyKey: true }
  );
  const orderUnconfirmed = orderSubmission.unconfirmed;
  const wizard = useWizardStep('/electricity/orders/new', 2);
  const { step, restore } = wizard;
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  const [editTarget, setEditTarget] = useState<string>();
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    const target = step === 1 && editTarget ? document.getElementById(editTarget) : heading.current;
    target?.focus();
    if (editTarget) setEditTarget(undefined);
  }, [editTarget, step]);
  const [draftLoading, setDraftLoading] = useState(true);
  const [draftError, setDraftError] = useState(false);
  const drafts = useElectricityDraftPersistence('simple');
  const { reset: resetDraft, retire: retireDraft, readRevision } = drafts;
  const savingDraft = drafts.working;
  const held = orderUnconfirmed || !!drafts.recovery;
  const draftGeneration = useRef(0);
  const completed = useRef(false);
  const [draftRetry, setDraftRetry] = useState(0);
  const savedDraftSignature = useRef(JSON.stringify(['current_month', '', '', '', '']));

  const inputSignature = () =>
    JSON.stringify([
      period,
      totalKwh,
      giftCode,
      appliedGiftCode,
      addressTouched ? selectedAddressId : '',
    ]);
  const signature = inputSignature();
  const liveSignature = useRef(signature);
  useLayoutEffect(() => {
    liveSignature.current = signature;
  }, [signature]);
  const unsavedAddress =
    showNewAddressForm &&
    [formProvinceId, formCityId, formFullAddress, formPostalCode].some(Boolean);
  const unsavedChanges =
    !draftLoading &&
    !completed.current &&
    (signature !== savedDraftSignature.current || unsavedAddress);
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      !completed.current &&
      (unsavedChanges ||
        held ||
        !!drafts.active.current ||
        orderSaveInFlight.current ||
        addressSaveInFlight.current ||
        fields.isPending()),
    enableBeforeUnload: () =>
      !completed.current &&
      (unsavedChanges ||
        held ||
        !!drafts.active.current ||
        orderSaveInFlight.current ||
        addressSaveInFlight.current ||
        fields.isPending()),
    withResolver: true,
  });
  const activeBlocker = useRef(blocker);
  activeBlocker.current = blocker;

  useEffect(() => {
    if (!orderCreated) return;
    void navigate({
      to: '/electricity/orders/$orderId',
      params: { orderId: orderCreated.orderId },
    }).catch(() => {});
  }, [orderCreated, navigate]);

  // ── Fetch verification status ───────────────────────────────────────

  const checkVerification = useCallback(async () => {
    const current = ++verificationGeneration.current;
    setChecking(true);
    setBlocked(null);
    setActiveProfileId(null);
    setActiveProfileName(null);
    setVerificationError(false);
    try {
      const data = await readIntake<Record<string, unknown> | null>(
        queryKeys.profiles.authority(intakeScope, 'electricity-intake-verification'),
        '/api/profiles/verification-status',
        'Verification unavailable',
        {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        }
      );
      if (
        !data ||
        typeof data !== 'object' ||
        !(
          data.activeProfileId === null ||
          (typeof data.activeProfileId === 'string' && data.activeProfileId.length > 0)
        ) ||
        typeof data.verificationRequired !== 'boolean' ||
        typeof data.isVerified !== 'boolean'
      ) {
        throw new Error('Invalid verification status');
      }
      if (current !== verificationGeneration.current) return;
      setActiveProfileId(data.activeProfileId);
      setActiveProfileName(
        typeof data.activeProfileName === 'string' && data.activeProfileName.trim()
          ? data.activeProfileName.trim()
          : null
      );
      setBlocked(
        data.profileStatus === 'DRAFT' ||
          data.profileStatus === 'SUSPENDED' ||
          (data.verificationRequired && !data.isVerified)
      );
    } catch {
      if (current === verificationGeneration.current) setVerificationError(true);
    } finally {
      if (current === verificationGeneration.current) setChecking(false);
    }
  }, [readIntake, intakeScope]);

  // ── Fetch products ──────────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    const current = ++productGeneration.current;
    setLoadingProducts(true);
    setProductError(false);
    setProducts([]);
    setSelectedProductId('');
    try {
      const data: unknown = await readIntake(
        queryKeys.catalogue.detail(intakeScope, 'electricity-intake-products'),
        '/api/products/electricity',
        'Products unavailable'
      );
      if (!Array.isArray(data)) throw new Error('Invalid products');
      // The catalogue includes unavailable placeholders for the other three
      // system products. Only thermal can be selected in simple ordering.
      const thermal = data.filter((product) => product?.systemKey === 'thermal');
      if (
        thermal.some(
          (product) =>
            !product ||
            typeof product !== 'object' ||
            typeof product.id !== 'string' ||
            typeof product.systemKey !== 'string' ||
            typeof product.status !== 'string' ||
            typeof product.simpleOrderable !== 'boolean' ||
            !product.limits ||
            !/^\d+$/.test(product.limits.minKwh) ||
            !/^\d+$/.test(product.limits.maxKwh) ||
            !product.title ||
            typeof product.title !== 'object' ||
            Array.isArray(product.title) ||
            Object.values(product.title).some((title) => typeof title !== 'string') ||
            !(
              product.price === null ||
              (typeof product.price === 'string' && /^\d+$/.test(product.price))
            )
        )
      )
        throw new Error('Invalid products');
      if (current !== productGeneration.current) return;
      const items: Product[] = thermal.filter((product) => product.simpleOrderable);
      setProducts(items);
      setSelectedProductId(items[0]?.id ?? '');
    } catch {
      if (current === productGeneration.current) setProductError(true);
    } finally {
      if (current === productGeneration.current) setLoadingProducts(false);
    }
  }, [readIntake, intakeScope]);

  // ── Fetch addresses ─────────────────────────────────────────────────

  const fetchAddresses = useCallback(async () => {
    const current = ++addressGeneration.current;
    setLoadingAddresses(true);
    setAddressError(false);
    setAddresses([]);
    if (!activeProfileId) {
      setLoadingAddresses(false);
      return;
    }
    try {
      const data = await readIntake<unknown>(
        queryKeys.profiles.list(
          { ...intakeScope, context: 'customer', ownerId: activeProfileId },
          new URLSearchParams({ owner: 'electricity-intake-addresses' })
        ),
        `/api/profiles/${activeProfileId}/addresses`,
        'Addresses unavailable',
        { credentials: 'include' }
      );
      if (current !== addressGeneration.current) return;
      const items = readIntakeAddresses(data, activeProfileId);
      setAddresses(items);
      setSelectedAddressId((current) => current || defaultIntakeAddressId(items));
    } catch {
      if (current === addressGeneration.current) setAddressError(true);
    } finally {
      if (current === addressGeneration.current) setLoadingAddresses(false);
    }
  }, [activeProfileId, readIntake, intakeScope]);

  // ── Effects ─────────────────────────────────────────────────────────

  useEffect(() => {
    checkVerification();
    fetchProducts();
    return () => {
      ++verificationGeneration.current;
      ++productGeneration.current;
    };
  }, [checkVerification, fetchProducts]);

  useEffect(() => {
    void fetchAddresses();
    return () => {
      ++addressGeneration.current;
    };
  }, [fetchAddresses]);

  // Fetch cities for each unique province referenced by existing addresses
  useEffect(() => {
    const controller = new AbortController();
    const uniqueProvinceIds = [...new Set(addresses.map((a) => a.provinceId))];
    for (const pid of uniqueProvinceIds) {
      void loadGeographyOptions(
        `/api/geography/provinces/${encodeURIComponent(pid)}/cities`,
        controller.signal,
        pid
      )
        .then((data) => {
          if (controller.signal.aborted) return;
          setCityMap((previous) => ({
            ...previous,
            ...Object.fromEntries(
              data.map((city) => [city.id, { nameFa: city.nameFa, nameEn: city.nameEn }])
            ),
          }));
        })
        .catch(() => {
          /* Existing address names fall back to their identifiers. */
        });
    }
    return () => controller.abort();
  }, [addresses]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingPeriods(true);
    void readIntake<unknown>(
      queryKeys.catalogue.detail(intakeScope, 'electricity-intake-periods'),
      '/api/electricity/periods/simple',
      'Periods unavailable',
      { credentials: 'include', signal: controller.signal }
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        const options = periodsResponse.parse(data).periods;
        restorePeriodFocus.current = document.activeElement === periodRetryButton.current;
        setPeriodOptions(options);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPeriodOptions([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingPeriods(false);
      });
    return () => controller.abort();
  }, [readIntake, intakeScope, periodRetry]);

  useLayoutEffect(() => {
    if (!periodOptions.length || !restorePeriodFocus.current) return;
    restorePeriodFocus.current = false;
    (document.getElementById('electricity-period') ?? heading.current)?.focus();
  }, [periodOptions]);

  useEffect(() => {
    if (!activeProfileId) return;
    const controller = new AbortController();
    setBillSuggestion(null);
    void readIntake<BillSuggestion>(
      queryKeys.orders.detail(
        { ...intakeScope, context: 'customer', ownerId: activeProfileId },
        `intake-bill:${period}`
      ),
      `/api/electricity/bill-data/${activeProfileId}?period=${period}`,
      'Bill data unavailable',
      { credentials: 'include', signal: controller.signal }
    )
      .then((data) => {
        if (!controller.signal.aborted) setBillSuggestion(data);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setBillSuggestion({
            available: false,
            reason: 'provider_error',
            manualEntryAllowed: true,
          });
      });
    return () => controller.abort();
  }, [activeProfileId, period, billSuggestionRetry, readIntake, intakeScope]);

  useEffect(() => {
    if (!activeProfileId) return;
    const epoch = ++draftGeneration.current;
    const controller = new AbortController();
    wizard.reset();
    resetDraft();
    orderSaveInFlight.current = false;
    setSubmitting(false);
    completed.current = false;
    setDraftLoading(true);
    setDraftError(false);
    void readIntake<{
      currentStep: number;
      data: {
        period: SimplePeriod;
        totalKwh?: string;
        giftCode?: string;
        giftCodeInput?: string;
        addressId?: string;
      } | null;
    }>(
      queryKeys.orders.detail(
        { ...intakeScope, context: 'customer', ownerId: activeProfileId },
        'intake-draft'
      ),
      electricityDraftPath('simple', activeProfileId),
      'Draft unavailable',
      { credentials: 'include', signal: controller.signal }
    )
      .then((draft) => {
        if (controller.signal.aborted) return;
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
              !Object.hasOwn(periodLabels, draft.data.period) ||
              (draft.data.totalKwh !== undefined &&
                (typeof draft.data.totalKwh !== 'string' ||
                  !/^[1-9]\d*$/.test(draft.data.totalKwh))) ||
              (draft.data.giftCode !== undefined && typeof draft.data.giftCode !== 'string') ||
              (draft.data.giftCodeInput !== undefined &&
                typeof draft.data.giftCodeInput !== 'string') ||
              (draft.data.addressId !== undefined && typeof draft.data.addressId !== 'string')))
        )
          throw new Error('Invalid draft');
        readRevision(draft);
        setPeriod(draft.data?.period ?? 'current_month');
        setTotalKwh(draft.data?.totalKwh ?? '');
        setGiftCode(draft.data?.giftCodeInput ?? draft.data?.giftCode ?? '');
        setAppliedGiftCode(draft.data?.giftCode ?? '');
        if (draft.data?.addressId) setSelectedAddressId(draft.data.addressId);
        setAddressTouched(Boolean(draft.data?.addressId));
        savedDraftSignature.current = JSON.stringify([
          draft.data?.period ?? 'current_month',
          draft.data?.totalKwh ?? '',
          draft.data?.giftCodeInput ?? draft.data?.giftCode ?? '',
          draft.data?.giftCode ?? '',
          draft.data?.addressId ?? '',
        ]);
        wizard.restore(draft.currentStep === 5 ? 2 : 1);
        setDraftLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDraftError(true);
          setDraftLoading(false);
        }
      });
    return () => {
      controller.abort();
      retireDraft();
      if (draftGeneration.current === epoch) draftGeneration.current++;
    };
  }, [activeProfileId, draftRetry, readIntake, intakeScope, readRevision, resetDraft, retireDraft]);

  useEffect(() => {
    const selected = products.find((item) => item.id === selectedProductId);
    const validQuantity =
      /^[1-9]\d*$/.test(totalKwh) &&
      !!selected &&
      (selected.limits.minKwh === '0' || BigInt(totalKwh) >= BigInt(selected.limits.minKwh)) &&
      (selected.limits.maxKwh === '0' || BigInt(totalKwh) <= BigInt(selected.limits.maxKwh));
    if (
      !activeProfileId ||
      !validQuantity ||
      !periodOptions.some((option) => option.key === period)
    ) {
      setQuote(null);
      setQuoteError('');
      setQuoting(false);
      return;
    }
    const controller = new AbortController();
    setQuote(null);
    setQuoteError('');
    setQuoting(true);
    const timer = window.setTimeout(() => {
      void readWithDeadline(controller.signal, async (signal) => {
        const response = await fetch('/api/electricity/preview/simple', {
          method: 'POST',
          credentials: 'include',
          signal,
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            profileId: activeProfileId,
            period,
            totalKwh,
            ...(appliedGiftCode ? { giftCode: appliedGiftCode } : {}),
          }),
        });
        if (!response.ok)
          throw new ElectricityQuotePreviewError(await electricityQuoteError(response, locale));
        return response.json() as Promise<PriceQuote>;
      })
        .then((data) => {
          if (!controller.signal.aborted) setQuote({ key: quoteKey, data });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setQuoteError(
              error instanceof ElectricityQuotePreviewError
                ? error.message
                : t('electricity.order.previewUnavailable', locale)
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setQuoting(false);
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    activeProfileId,
    selectedProductId,
    products,
    period,
    totalKwh,
    appliedGiftCode,
    quoteVersion,
    quoteKey,
    periodOptions,
    locale,
  ]);

  // ── Helpers ─────────────────────────────────────────────────────────

  const getProvinceName = (provinceId: string): string => {
    const province = provinces.find((p) => p.id === provinceId);
    if (!province) return provinceId;
    return locale === 'fa' ? province.nameFa : province.nameEn;
  };

  const getCityName = (cityId: string): string => {
    // First try the current form cities list
    const city = cities.find((c) => c.id === cityId);
    if (city) return locale === 'fa' ? city.nameFa : city.nameEn;
    // Fall back to the accumulated city map
    const mapped = cityMap[cityId];
    if (mapped) return locale === 'fa' ? mapped.nameFa : mapped.nameEn;
    return cityId;
  };

  const productTitle = (product?: Product) =>
    product ? product.title[locale] || product.title.en || product.title.fa || product.id : '';

  const selectedAddress = addresses.find((a) => a.id === selectedAddressId);
  const addressReady = !draftLoading && !draftError && !loadingAddresses && !addressError;
  const savedAddressUnavailable = addressReady && !!selectedAddressId && !selectedAddress;
  useEffect(() => {
    if (step === 2 && addressReady && !selectedAddress) restore(1);
  }, [addressReady, restore, selectedAddress, step]);
  const selectedProduct = products.find((item) => item.id === selectedProductId);
  const selectedPeriod = periodOptions.find((option) => option.key === period);
  const selectedPeriodDates = useMemo(
    () => (selectedPeriod ? periodDates(selectedPeriod, locale) : null),
    [selectedPeriod, locale]
  );
  const calendarLabels = {
    jalali: simpleElectricityOrderText('jalaliCalendar', locale),
    gregorian: simpleElectricityOrderText('gregorianCalendar', locale),
  };
  const quantityError = totalKwh !== '' && !quantityValid(totalKwh, selectedProduct);

  // ── Save new address ─────────────────────────────────────────────────

  const postalCode = normalizeProfileDigits(formPostalCode.trim());
  const addressValidity = {
    formProvinceId: provinces.some((province) => province.id === formProvinceId),
    formCityId: cities.some((city) => city.id === formCityId && city.provinceId === formProvinceId),
    formFullAddress: !!formFullAddress.trim(),
    formPostalCode: validatePostalCode(postalCode),
  };
  type AddressField = keyof typeof addressValidity;

  function addressFieldInvalid(name: AddressField) {
    return (
      addressChecked &&
      !addressValidity[name] &&
      (name !== 'formCityId' || (addressValidity.formProvinceId && cityOptions.ready))
    );
  }

  function bindAddressField(name: AddressField) {
    const invalid = addressFieldInvalid(name);
    return {
      ...fields.bind(name),
      'aria-required': true,
      'aria-invalid': invalid || undefined,
      'aria-describedby': invalid || name === 'formPostalCode' ? fields.errorId(name) : undefined,
    };
  }

  const provinceField = bindAddressField('formProvinceId');
  const cityField = bindAddressField('formCityId');

  function addressFieldError(name: AddressField) {
    if (name === 'formPostalCode') {
      const invalid = addressFieldInvalid(name);
      return (
        <p
          id={fields.errorId(name)}
          className={invalid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
        >
          {addressesText('postalCodeFormat', locale)}
        </p>
      );
    }
    return addressFieldInvalid(name) ? (
      <p id={fields.errorId(name)} className="text-sm text-destructive">
        {t('formWizard.invalidField', locale)}
      </p>
    ) : null;
  }

  function openNewAddress() {
    setShowNewAddressForm(true);
    requestAnimationFrame(() => addressHeading.current?.focus());
  }

  function clearNewAddress() {
    setShowNewAddressForm(false);
    setAddressChecked(false);
    setFormProvinceId('');
    setFormCityId('');
    setFormFullAddress('');
    setFormPostalCode('');
  }

  async function handleSaveNewAddress() {
    if (
      addressSaveInFlight.current ||
      orderSaveInFlight.current ||
      drafts.active.current ||
      drafts.recovery ||
      completed.current
    )
      return;
    if (checking || blocked !== false || verificationError || loadingAddresses || addressError)
      return;
    if (
      loadingProvinces ||
      provinceError ||
      loadingCities ||
      cityError ||
      (addressValidity.formProvinceId && !cityOptions.ready)
    )
      return;
    const invalid = (Object.keys(addressValidity) as AddressField[]).find(
      (name) => !addressValidity[name]
    );
    if (invalid) {
      setAddressChecked(true);
      requestAnimationFrame(() => fields.form.setFocus(invalid));
      return;
    }

    if (!activeProfileId) return;

    addressSaveInFlight.current = true;
    const generation = addressGeneration.current;
    const input = {
      provinceId: formProvinceId,
      cityId: formCityId,
      fullAddress: formFullAddress.trim(),
      postalCode,
    };
    setSavingAddress(true);
    try {
      const res = await fetch(`/api/profiles/${activeProfileId}/addresses`, {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        toast.error(addressFormText('settings.addresses.error.create', locale));
        return;
      }

      const newAddress: IntakeAddress = await res.json();
      if (
        !newAddress ||
        typeof newAddress.id !== 'string' ||
        !newAddress.id.trim() ||
        newAddress.profileId !== activeProfileId ||
        typeof newAddress.mainAddress !== 'boolean' ||
        (Object.keys(input) as Array<keyof typeof input>).some(
          (key) => newAddress[key] !== input[key]
        )
      )
        throw new Error('Invalid saved address');
      if (generation !== addressGeneration.current) return;
      toast.success(addressFormText('settings.addresses.success.create', locale));

      // Add to list and select it
      setAddresses((prev) => [...prev, newAddress]);
      setSelectedAddressId(newAddress.id);
      setAddressTouched(true);
      clearNewAddress();
      requestAnimationFrame(() => addressHeading.current?.focus());
    } catch {
      if (generation === addressGeneration.current)
        toast.error(addressFormText('settings.addresses.error.create', locale));
    } finally {
      if (generation === addressGeneration.current) {
        addressSaveInFlight.current = false;
        setSavingAddress(false);
      }
    }
  }

  const saveDraft = async (advance: boolean, target = advance ? step + 1 : step, leave = false) => {
    if (held) return false;
    if (unsavedAddress) {
      toast.error(t('electricity.order.unsaved.address', locale));
      return false;
    }
    if (
      drafts.active.current ||
      orderSaveInFlight.current ||
      addressSaveInFlight.current ||
      completed.current ||
      draftLoading ||
      draftError ||
      !activeProfileId ||
      target < 1 ||
      target > 2
    )
      return false;
    if (advance && (!quote || quoting || quoteError)) {
      toast.error(t('electricity.order.previewUnavailable', locale));
      return false;
    }
    if (advance && (loadingAddresses || addressError || !selectedAddress)) {
      toast.error(t('electricity.order.selectAddress', locale));
      return false;
    }
    if (advance && giftCode.trim() !== appliedGiftCode) {
      toast.error(t('electricity.order.applyGiftFirst', locale));
      return false;
    }
    const epoch = draftGeneration.current;
    const signature = inputSignature();
    const input = {
      profileId: activeProfileId,
      // Keep the public draft protocol compatible with records saved by the five-stage flow.
      currentStep: target === 2 ? 5 : 1,
      data: {
        period,
        ...(totalKwh ? { totalKwh } : {}),
        ...(appliedGiftCode ? { giftCode: appliedGiftCode } : {}),
        ...(giftCode ? { giftCodeInput: giftCode } : {}),
        ...((addressTouched || advance || target === 2) && selectedAddressId
          ? { addressId: selectedAddressId }
          : {}),
      },
    };
    const saved = await drafts.save(
      input,
      async () => {
        if (epoch !== draftGeneration.current) return false;
        savedDraftSignature.current = signature;
        if (liveSignature.current !== signature) return false;
        if (target !== step) await wizard.go(target, step);
        else toast.success(t('electricity.order.draftSaved', locale));
        return true;
      },
      leave
    );
    if (!saved && epoch === draftGeneration.current && !drafts.unresolved.current)
      toast.error(t('electricity.order.draftSaveFailed', locale));
    return saved;
  };

  // ── Submit order ────────────────────────────────────────────────────

  const financialGate = useRiskConfirmation(
    JSON.stringify([activeProfileId, selectedAddressId, quote?.reviewDigest]),
    locale,
    'financial'
  );
  async function sendOrder(input?: object) {
    if (
      !activeProfileId ||
      drafts.recovery ||
      checking ||
      blocked !== false ||
      verificationError ||
      orderSaveInFlight.current ||
      drafts.active.current ||
      addressSaveInFlight.current ||
      completed.current
    )
      return;
    orderSaveInFlight.current = true;
    setSubmitting(true);
    const generation = verificationGeneration.current;
    const draftEpoch = draftGeneration.current;
    const current = () =>
      generation === verificationGeneration.current && draftEpoch === draftGeneration.current;
    try {
      const result = await orderSubmission.send(input, current);
      if (!current()) return;
      if (result.status === 'confirmed') {
        completed.current = true;
        setOrderCreated(result.receipt);
        toast.success(t('electricity.order.success.create', locale));
      } else if (result.status === 'conflict') {
        setQuoteVersion((version) => version + 1);
        toast.error(t('electricity.order.reviewChanged', locale));
      } else if (result.status === 'unconfirmed') {
        toast.error(t('electricity.order.unconfirmed', locale));
      } else if (result.status === 'rejected') {
        toast.error(t('electricity.order.error.create', locale));
      }
    } finally {
      if (current()) {
        orderSaveInFlight.current = false;
        setSubmitting(false);
      }
    }
  }

  async function handleSubmitOrder() {
    if (!financialGate.allowed || held) return;
    if (
      orderSaveInFlight.current ||
      addressSaveInFlight.current ||
      drafts.active.current ||
      drafts.recovery ||
      completed.current ||
      showNewAddressForm
    )
      return;
    if (
      loadingProducts ||
      productError ||
      !products.some((product) => product.id === selectedProductId)
    )
      return;
    if (checking || blocked !== false || verificationError || loadingAddresses || addressError)
      return;
    if (!selectedProductId) {
      toast.error(simpleElectricityOrderText('noProduct', locale));
      return;
    }
    if (!selectedAddressId || !selectedAddress) {
      toast.error(simpleElectricityOrderText('noAddress', locale));
      return;
    }
    if (!activeProfileId) {
      toast.error(simpleElectricityOrderText('noProfile', locale));
      return;
    }
    if (!quote || quoting || quoteError || giftCode.trim() !== appliedGiftCode) {
      toast.error(t('electricity.order.previewUnavailable', locale));
      return;
    }

    await sendOrder({
      profileId: activeProfileId,
      period,
      totalKwh,
      expectedQuoteDigest: quote.reviewDigest,
      ...(appliedGiftCode ? { giftCode: appliedGiftCode } : {}),
      address: {
        provinceId: selectedAddress.provinceId,
        cityId: selectedAddress.cityId,
        fullAddress: selectedAddress.fullAddress,
        postalCode: selectedAddress.postalCode,
      },
    });
  }

  // ── Render: Loading ─────────────────────────────────────────────────

  if (checking) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <h1 className="sr-only">{t('electricity.order.title', locale)}</h1>
        <LoadingStatus className="text-muted-foreground">
          {t('electricity.order.checking', locale)}
        </LoadingStatus>
      </div>
    );
  }

  if (verificationError || (blocked === false && !activeProfileId)) {
    return (
      <div
        className="container mx-auto max-w-md space-y-4 p-6"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <h1 className="sr-only">{t('electricity.order.title', locale)}</h1>
        <p role="alert">
          {t(
            verificationError
              ? 'electricity.order.checkFailed'
              : 'electricity.order.error.noProfile',
            locale
          )}
        </p>
        <Button onClick={() => void checkVerification()}>
          {t('electricity.order.retry', locale)}
        </Button>
      </div>
    );
  }

  // ── Render: Blocked (unverified profile) ────────────────────────────

  if (blocked) {
    return (
      <div
        className="container mx-auto flex min-h-[50vh] items-center justify-center p-4"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <div className="max-w-md text-center">
          <div className="mb-4 text-4xl">⚠️</div>
          <h1 className="mb-4 text-2xl font-bold">
            {simpleElectricityOrderText('blockedTitle', locale)}
          </h1>
          <p className="mb-6 text-muted-foreground">
            {simpleElectricityOrderText('blockedDescription', locale)}
          </p>
          <p className="text-sm text-muted-foreground">
            {simpleElectricityOrderText('blockedSupport', locale)}
          </p>
        </div>
      </div>
    );
  }

  if (draftLoading || draftError) {
    return (
      <div
        className="container mx-auto max-w-md space-y-4 p-6"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <h1 className="sr-only">{t('electricity.order.title', locale)}</h1>
        {draftLoading && <SkeletonText lines={2} />}
        <p role={draftError ? 'alert' : 'status'}>
          {t(
            draftError ? 'electricity.order.draftLoadFailed' : 'electricity.order.draftLoading',
            locale
          )}
        </p>
        {draftError && (
          <Button onClick={() => setDraftRetry((value) => value + 1)}>
            {t('electricity.order.retry', locale)}
          </Button>
        )}
      </div>
    );
  }

  // ── Render: Order created success ───────────────────────────────────

  if (orderCreated) {
    return (
      <div
        className="container mx-auto flex min-h-[50vh] items-center justify-center p-4"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <div className="max-w-md text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckIcon className="h-8 w-8" />
          </div>
          <h1 className="mb-4 text-2xl font-bold">
            {t('electricity.order.success.title', locale)}
          </h1>
          <p className="mb-6 text-muted-foreground">
            {t('electricity.order.success.description', locale)}
          </p>
          <p className="mb-4 text-sm text-muted-foreground">
            {t('electricity.order.paymentOptions', locale)}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <span>
              {t('electricity.order.success.order', locale)}: {orderCreated.orderId}
            </span>
            <a
              href={`/contracts/${encodeURIComponent(orderCreated.contractId)}`}
              className="text-primary underline underline-offset-4"
            >
              {t('electricity.order.success.contract', locale)}: {orderCreated.contractId}
            </a>
            <a
              href={`/invoices/${orderCreated.invoiceId}`}
              className="text-primary underline underline-offset-4"
            >
              {t('electricity.order.success.invoice', locale)}
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Main order form ─────────────────────────────────────────

  const draftRecovery = drafts.recovery && (
    <ElectricityDraftRecovery
      phase={drafts.recovery}
      locale={locale}
      working={drafts.working}
      discardRetry={drafts.discardRetry}
      onAction={async () => {
        if (drafts.recovery === 'stale') {
          if (blocker.status === 'blocked') blocker.reset();
          setDraftRetry((value) => value + 1);
        } else if (await drafts.recover()) {
          const latest = activeBlocker.current;
          if (latest.status === 'blocked') latest.proceed();
        }
      }}
    />
  );

  const quoteErrorNotice = quoteError ? (
    <ElectricityQuoteErrorNotice
      message={quoteError}
      onRetry={() => setQuoteVersion((version) => version + 1)}
    />
  ) : null;

  const periodReadFeedback = periodOptions.length === 0 && (
    <div className="flex flex-wrap items-center gap-x-2">
      <p id="electricity-period-dates" className="mt-1 text-xs text-muted-foreground" role="status">
        {t(
          loadingPeriods
            ? 'electricity.order.period.loading'
            : 'electricity.order.period.unavailable',
          locale
        )}
      </p>
      {(!loadingPeriods || periodRetry > 0) && (
        <Button
          type="button"
          variant="link"
          className="min-h-11 px-1"
          data-testid="period-retry"
          ref={periodRetryButton}
          focusableWhenDisabled
          disabled={loadingPeriods}
          onClick={() => setPeriodRetry((attempt) => attempt + 1)}
        >
          {simpleElectricityOrderText('retryPeriods', locale)}
        </Button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl py-4 sm:py-7" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {blocker.status === 'blocked' && (
        <Suspense>
          <LeaveDialog
            working={fields.pending || savingDraft || submitting || savingAddress}
            workingLabel={t(
              submitting ? 'electricity.order.submitting' : 'electricity.order.savingDraft',
              locale
            )}
            saveDisabled={held || draftLoading || draftError || unsavedAddress}
            errorMessage={
              orderUnconfirmed
                ? t('electricity.order.unconfirmed', locale)
                : unsavedAddress
                  ? t('electricity.order.unsaved.address', locale)
                  : undefined
            }
            onSave={async () => (await saveDraft(false, step, true)) && !unsavedAddress}
            onStay={() => blocker.reset()}
            recovery={draftRecovery}
            onDiscardSaved={
              held
                ? undefined
                : async () =>
                    !!activeProfileId &&
                    !orderSaveInFlight.current &&
                    !addressSaveInFlight.current &&
                    !completed.current &&
                    drafts.discard(activeProfileId)
            }
            onLeave={() => blocker.proceed()}
          />
        </Suspense>
      )}
      <header className="mb-3 space-y-1 border-b pb-3 sm:mb-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <Link
            to="/electricity"
            className="inline-flex min-h-9 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('electricity.catalogue.title', locale)}
          </Link>
          {step === 1 && (
            <Link
              to="/electricity/orders/new/advanced"
              className="inline-flex min-h-9 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('electricity.catalogue.advancedOrder', locale)}
            </Link>
          )}
        </div>
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold sm:text-3xl">
          {t(step === 1 ? 'electricity.order.title' : 'electricity.order.review', locale)}
        </h1>
        {step === 1 && selectedProduct && products.length === 1 && (
          <p className="text-sm text-muted-foreground">
            {productTitle(selectedProduct)}
            {selectedProduct.price && (
              <>
                {' '}
                · <bdi>{numbers.money(selectedProduct.price)}</bdi>
              </>
            )}
          </p>
        )}
      </header>
      {blocker.status !== 'blocked' && draftRecovery}
      {orderUnconfirmed && (
        <SubmissionRecovery busy={submitting} onRetry={() => void sendOrder()} />
      )}
      <Suspense fallback={<p role="status">{t('electricity.order.previewLoading', locale)}</p>}>
        <ValidatedFormWizard
          form={fields.form}
          errorId={fields.errorId}
          onPendingChange={fields.setValidationPending}
          disabled={
            checking ||
            blocked !== false ||
            verificationError ||
            draftLoading ||
            draftError ||
            completed.current ||
            held ||
            submitting ||
            savingAddress ||
            savingDraft
          }
          onInvalidStep={(target) => wizard.go(target, step)}
          fields={[
            [
              { name: 'selectedProductId', label: t('electricity.order.selectProduct', locale) },
              { name: 'period', label: t('electricity.order.period.selection', locale) },
              { name: 'totalKwh', label: t('electricity.order.quantity', locale) },
              { name: 'selectedAddressId', label: t('electricity.order.selectAddress', locale) },
              { name: 'giftCode', label: t('electricity.order.giftCode', locale) },
            ],
            [],
          ]}
          steps={[t('electricity.order.step2', locale), t('electricity.order.review', locale)]}
          step={step}
          hideProgress
          actionsInContent={step === 1}
          actionsClassName={
            step === 1
              ? `${wizardActionSurface} ${showNewAddressForm ? '' : 'max-lg:sticky max-lg:bottom-0 max-lg:z-20 max-lg:pb-[max(0.5rem,env(safe-area-inset-bottom))]'} lg:rounded-t-none lg:border-x-0 lg:border-b-0 lg:border-primary/20 [&>button]:min-h-11`
              : wizardActionSurface
          }
          actionSummary={
            step === 1 && !showNewAddressForm && quote && !quoting && !quoteError ? (
              <span aria-hidden="true" className="w-full text-sm font-semibold lg:hidden">
                {t('electricity.order.total', locale)} <bdi>{numbers.money(quote.totalIrR)}</bdi>
              </span>
            ) : undefined
          }
          ariaLabel={t('electricity.order.steps', locale)}
          backLabel={t('electricity.order.edit', locale)}
          saveLabel={t('electricity.order.saveDraft', locale)}
          nextLabel={t('electricity.order.review', locale)}
          submitLabel={t('electricity.order.submit', locale)}
          savingLabel={t('electricity.order.savingDraft', locale)}
          submittingLabel={t('electricity.order.submitting', locale)}
          saving={savingDraft}
          submitting={submitting}
          backDisabled={held}
          saveDisabled={
            held ||
            draftLoading ||
            draftError ||
            quantityError ||
            savingAddress ||
            unsavedAddress ||
            completed.current
          }
          nextDisabled={
            held ||
            draftLoading ||
            draftError ||
            savingAddress ||
            unsavedAddress ||
            completed.current ||
            !selectedProduct ||
            !selectedPeriod ||
            !totalKwh ||
            quantityError ||
            !quote ||
            quoting ||
            !!quoteError ||
            giftCode.trim() !== appliedGiftCode ||
            loadingAddresses ||
            addressError ||
            !selectedAddress ||
            showNewAddressForm
          }
          submitDisabled={
            held ||
            !financialGate.allowed ||
            draftLoading ||
            draftError ||
            savingDraft ||
            savingAddress ||
            showNewAddressForm ||
            loadingAddresses ||
            addressError ||
            !selectedProductId ||
            !selectedAddress ||
            !quote ||
            quoting ||
            periodOptions.length === 0
          }
          onBack={() => void saveDraft(false, 1)}
          onSave={() => void saveDraft(false)}
          onNext={() => saveDraft(true)}
          onSubmit={handleSubmitOrder}
        >
          {(pending, actions) => (
            <fieldset
              className="min-w-0"
              disabled={
                held || pending || savingDraft || submitting || savingAddress || completed.current
              }
            >
              <legend className="sr-only">{t('electricity.order.steps', locale)}</legend>
              {step === 1 && (
                <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(17rem,1fr)]">
                  <div className="min-w-0">
                    {products.length !== 1 && (
                      <Card size="sm" className="mb-3">
                        <CardContent>
                          <h2
                            id="electricity-product-title"
                            className="mb-2 flex items-center gap-2 text-base font-semibold"
                          >
                            <PackageIcon className="h-5 w-5" />
                            {t('electricity.order.selectProduct', locale)}
                          </h2>

                          {loadingProducts ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Skeleton className="h-6 w-20 shrink-0" />
                              {simpleElectricityOrderText('loadingProducts', locale)}
                            </div>
                          ) : productError ? (
                            <div className="space-y-3" role="alert">
                              <p>{simpleElectricityOrderText('productLoadFailed', locale)}</p>
                              <Button onClick={() => void fetchProducts()}>
                                {t('electricity.order.retry', locale)}
                              </Button>
                            </div>
                          ) : products.length === 0 ? (
                            <NoDeadEndBanner
                              title={simpleElectricityOrderText('noProducts', locale)}
                              description={serviceFeedback('next', locale)}
                              responsibleTeam={serviceFeedback('team', locale)}
                              action={
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => void fetchProducts()}
                                >
                                  {t('electricity.order.retry', locale)}
                                </Button>
                              }
                              help={
                                <Link to="/tickets" className="underline">
                                  {serviceFeedback('support', locale)}
                                </Link>
                              }
                            />
                          ) : (
                            <div
                              role="radiogroup"
                              aria-labelledby="electricity-product-title"
                              aria-required="true"
                              className="space-y-2"
                            >
                              {products.map((product) => (
                                <label
                                  key={product.id}
                                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                                    selectedProductId === product.id
                                      ? 'border-primary bg-primary/5'
                                      : 'border-input hover:bg-muted'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    {...fields.bind('selectedProductId')}
                                    value={product.id}
                                    checked={selectedProductId === product.id}
                                    disabled={submitting}
                                    onChange={() => setSelectedProductId(product.id)}
                                    className="h-4 w-4 accent-primary"
                                  />
                                  <div className="flex-1">
                                    <p className="text-sm font-medium">{productTitle(product)}</p>
                                    {product.price && (
                                      <p className="text-xs text-muted-foreground">
                                        {numbers.money(product.price)}
                                      </p>
                                    )}
                                  </div>
                                </label>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                    <Card size="sm" className="mb-3">
                      <CardContent className="space-y-3">
                        <h2 className="text-lg font-semibold">
                          {t('electricity.order.step2', locale)}
                        </h2>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="min-w-0">
                            <label
                              htmlFor="electricity-period"
                              className="mb-1 block text-sm font-medium"
                            >
                              {t('electricity.order.period.selection', locale)}
                            </label>
                            <NativeSelect
                              id="electricity-period"
                              {...fields.bind('period')}
                              aria-required="true"
                              aria-describedby={
                                selectedPeriodDates || periodOptions.length === 0
                                  ? 'electricity-period-dates'
                                  : undefined
                              }
                              value={selectedPeriod ? period : ''}
                              disabled={submitting || periodOptions.length === 0}
                              onChange={(event) => setPeriod(event.target.value as SimplePeriod)}
                              className="w-full"
                            >
                              {!selectedPeriod && (
                                <option value="" disabled>
                                  {simpleElectricityOrderText('choosePeriod', locale)}
                                </option>
                              )}
                              {(['month', 'week'] as const).map((unit) => (
                                <optgroup
                                  key={unit}
                                  label={t(
                                    unit === 'month'
                                      ? 'electricity.order.period.monthly'
                                      : 'electricity.order.period.weekly',
                                    locale
                                  )}
                                >
                                  {periodOptions
                                    .filter((option) => option.key.includes(unit))
                                    .map((option) => (
                                      <option key={option.key} value={option.key}>
                                        {t(periodLabels[option.key], locale)} ·{' '}
                                        {periodChoiceDate(option, locale)}
                                      </option>
                                    ))}
                                </optgroup>
                              ))}
                            </NativeSelect>
                            {selectedPeriodDates ? (
                              <dl
                                id="electricity-period-dates"
                                className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground"
                              >
                                <dt>{calendarLabels.jalali}</dt>
                                <dd>
                                  <bdi lang="fa" dir="rtl">
                                    {selectedPeriodDates.jalali}
                                  </bdi>
                                </dd>
                                <dt>{calendarLabels.gregorian}</dt>
                                <dd>
                                  <bdi>{selectedPeriodDates.gregorian}</bdi>
                                </dd>
                              </dl>
                            ) : (
                              periodReadFeedback
                            )}
                          </div>
                          <div>
                            <label
                              htmlFor="electricity-kwh"
                              className="mb-1 block text-sm font-medium"
                            >
                              {t('electricity.order.quantity', locale)}
                            </label>
                            <Input
                              id="electricity-kwh"
                              dir="ltr"
                              className="text-start"
                              {...fields.bind('totalKwh')}
                              aria-required="true"
                              type="text"
                              inputMode="numeric"
                              pattern="[1-9][0-9]*"
                              value={totalKwh}
                              disabled={submitting}
                              onChange={(event) =>
                                setTotalKwh(normalizeProfileDigits(event.target.value))
                              }
                              aria-describedby={[
                                'electricity-kwh-hint',
                                quantityError
                                  ? 'electricity-kwh-error'
                                  : fields.form.getFieldState('totalKwh').invalid
                                    ? fields.errorId('totalKwh')
                                    : undefined,
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              aria-invalid={
                                quantityError || fields.form.getFieldState('totalKwh').invalid
                              }
                            />
                            <p
                              id="electricity-kwh-hint"
                              className="mt-1 text-xs text-muted-foreground"
                            >
                              {simpleElectricityOrderText('quantityHint', locale)}{' '}
                              {selectedProduct && (
                                <bdi dir="ltr" className="whitespace-nowrap">
                                  {selectedProduct.limits.minKwh}–
                                  {selectedProduct.limits.maxKwh === '0'
                                    ? '∞'
                                    : selectedProduct.limits.maxKwh}{' '}
                                  kWh
                                </bdi>
                              )}
                            </p>
                            {quantityError && (
                              <p
                                id="electricity-kwh-error"
                                role="alert"
                                className="mt-1 text-sm text-destructive"
                              >
                                {t('electricity.order.quantityInvalid', locale)}
                              </p>
                            )}
                          </div>
                        </div>
                        {!selectedPeriod ? null : billSuggestion?.available &&
                          billSuggestion.suggestedKwh ? (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/45 px-3 py-1.5 text-sm">
                            <p>
                              {simpleElectricityOrderText('estimate', locale)}:{' '}
                              <bdi dir="ltr" className="whitespace-nowrap">
                                {numbers.number(BigInt(billSuggestion.suggestedKwh))} kWh
                              </bdi>
                            </p>
                            {totalKwh !== billSuggestion.suggestedKwh && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="ms-auto text-primary"
                                onClick={() => {
                                  setTotalKwh(billSuggestion.suggestedKwh!);
                                  fields.form.setFocus('totalKwh');
                                }}
                              >
                                {simpleElectricityOrderText('useEstimate', locale)}
                              </Button>
                            )}
                            <details className="w-full text-xs text-muted-foreground">
                              <summary className="w-fit cursor-pointer rounded-sm py-1 hover:text-foreground">
                                {simpleElectricityOrderText('estimateDetails', locale)}
                              </summary>
                              <p className="pb-1 leading-relaxed">
                                {simpleElectricityOrderText('billDataSource', locale)} ·{' '}
                                {billSuggestion.dataPeriod && (
                                  <>
                                    <time dateTime={billSuggestion.dataPeriod.start}>
                                      {time.format(billSuggestion.dataPeriod.start, {
                                        dateStyle: 'medium',
                                        timeStyle: 'short',
                                      })}
                                    </time>
                                    {' – '}
                                    <time dateTime={billSuggestion.dataPeriod.end}>
                                      {time.format(billSuggestion.dataPeriod.end, {
                                        dateStyle: 'medium',
                                        timeStyle: 'short',
                                      })}
                                    </time>
                                  </>
                                )}{' '}
                                · {simpleElectricityOrderText('dataUpdated', locale)}:{' '}
                                {billSuggestion.dataTimestamp && (
                                  <time dateTime={billSuggestion.dataTimestamp}>
                                    {time.format(billSuggestion.dataTimestamp, {
                                      dateStyle: 'medium',
                                      timeStyle: 'short',
                                    })}
                                  </time>
                                )}{' '}
                                · {Math.round((billSuggestion.coverage ?? 0) * 100)}%{' '}
                                {simpleElectricityOrderText('coverage', locale)}.{' '}
                                {simpleElectricityOrderText('estimateDisclaimer', locale)}
                              </p>
                            </details>
                            {time.notice}
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <p role="status">
                              {billSuggestion === null
                                ? simpleElectricityOrderText('billDataLoading', locale)
                                : t('electricity.order.manualQuantity', locale)}
                            </p>
                            {billSuggestion !== null && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setBillSuggestionRetry((value) => value + 1)}
                              >
                                {t('electricity.order.retryBillData', locale)}
                              </Button>
                            )}
                          </div>
                        )}
                        <CheckoutGiftCode
                          disclosureId="electricity-gift-details"
                          inputId="electricity-gift"
                          summary={t('electricity.order.giftCode', locale)}
                          label={t('electricity.order.giftCode', locale)}
                          application={{
                            label: t('electricity.order.applyGift', locale),
                            applied: appliedGiftCode,
                            apply: setAppliedGiftCode,
                          }}
                          field={fields.bind('giftCode')}
                          value={giftCode}
                          disabled={submitting}
                          onChange={setGiftCode}
                        >
                          {appliedGiftCode && quote && (
                            <p className="text-sm text-primary">
                              {t('electricity.order.discount', locale)}:{' '}
                              {numbers.money(quote.discountIrR)}
                            </p>
                          )}
                        </CheckoutGiftCode>
                      </CardContent>
                    </Card>
                    <Card size="sm">
                      <CardContent>
                        <h2
                          id="electricity-address-title"
                          ref={addressHeading}
                          tabIndex={-1}
                          className="mb-3 flex scroll-mt-3 items-center gap-2 text-lg font-semibold"
                        >
                          <MapPinIcon className="h-5 w-5" />
                          {t(
                            showNewAddressForm
                              ? 'electricity.order.newAddressTitle'
                              : 'electricity.order.selectAddress',
                            locale
                          )}
                        </h2>

                        {!showNewAddressForm && savedAddressUnavailable && (
                          <div className="mb-3">
                            <WizardDraftAddressNotice />
                          </div>
                        )}
                        {loadingAddresses ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Skeleton className="h-6 w-20 shrink-0" />
                            {simpleElectricityOrderText('loadingAddresses', locale)}
                          </div>
                        ) : addressError ? (
                          <div className="space-y-3" role="alert">
                            <p>{t('electricity.order.addressLoadFailed', locale)}</p>
                            <Button onClick={() => void fetchAddresses()}>
                              {t('electricity.order.retry', locale)}
                            </Button>
                          </div>
                        ) : addresses.length === 0 && !showNewAddressForm ? (
                          <div className="text-center py-4">
                            <MapPinIcon className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                            <p className="text-sm text-muted-foreground mb-4">
                              {t('electricity.order.noAddresses', locale)}
                            </p>
                            <Button
                              ref={addAddressButton}
                              disabled={submitting}
                              onClick={openNewAddress}
                              className="gap-2"
                            >
                              <PlusIcon className="h-4 w-4" />
                              {t('electricity.order.addAddress', locale)}
                            </Button>
                          </div>
                        ) : (
                          <>
                            {/* Existing addresses */}
                            {addresses.length > 0 && !showNewAddressForm && (
                              <div className="space-y-2 mb-4">
                                <div
                                  role="radiogroup"
                                  aria-labelledby="electricity-address-title"
                                  aria-describedby={
                                    savedAddressUnavailable
                                      ? 'draft-address-unavailable'
                                      : undefined
                                  }
                                  aria-required="true"
                                  className="space-y-2"
                                >
                                  {addresses.map((address) => (
                                    <label
                                      key={address.id}
                                      htmlFor={`order-address-${address.id}`}
                                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                                        selectedAddressId === address.id
                                          ? 'border-primary bg-primary/5'
                                          : 'border-input hover:bg-muted'
                                      }`}
                                    >
                                      <input
                                        type="radio"
                                        id={`order-address-${address.id}`}
                                        {...fields.bind('selectedAddressId')}
                                        value={address.id}
                                        checked={selectedAddressId === address.id}
                                        disabled={submitting}
                                        onChange={() => {
                                          setSelectedAddressId(address.id);
                                          setAddressTouched(true);
                                        }}
                                        className="mt-1 h-4 w-4 shrink-0 accent-primary"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className="text-sm font-medium">
                                            {getProvinceName(address.provinceId)}،{' '}
                                            {getCityName(address.cityId)}
                                          </span>
                                          {address.mainAddress && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-0.5">
                                              <HomeIcon className="h-3 w-3" />
                                              {t('electricity.order.mainAddress', locale)}
                                            </span>
                                          )}
                                        </div>
                                        <p className="break-words text-sm text-muted-foreground">
                                          {address.fullAddress}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          {t('electricity.order.postalCode', locale)}:{' '}
                                          <bdi>{address.postalCode}</bdi>
                                        </p>
                                      </div>
                                    </label>
                                  ))}
                                </div>

                                <Button
                                  ref={addAddressButton}
                                  variant="outline"
                                  disabled={submitting}
                                  onClick={openNewAddress}
                                  className="w-full gap-2 mt-2"
                                >
                                  <PlusIcon className="h-4 w-4" />
                                  {t('electricity.order.addNewAddress', locale)}
                                </Button>
                              </div>
                            )}

                            {/* New address form */}
                            {showNewAddressForm && (
                              <div className="space-y-4">
                                {provinceError && (
                                  <div role="alert" className="space-y-2">
                                    <p>
                                      {simpleElectricityOrderText('provinceLoadFailed', locale)}
                                    </p>
                                    <Button onClick={provinceOptions.retry}>
                                      {t('electricity.order.retry', locale)}
                                    </Button>
                                  </div>
                                )}
                                {cityError && (
                                  <div role="alert" className="space-y-2">
                                    <p>{t('electricity.order.cityLoadFailed', locale)}</p>
                                    <Button onClick={cityOptions.retry}>
                                      {t('electricity.order.retry', locale)}
                                    </Button>
                                  </div>
                                )}
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div className="min-w-0 space-y-1">
                                    <label
                                      htmlFor="order-address-province"
                                      className="block text-sm font-medium"
                                    >
                                      {addressFormText('settings.addresses.form.province', locale)}
                                    </label>
                                    <GeographyPicker
                                      id="order-address-province"
                                      kind="province"
                                      locale={locale}
                                      inputRef={provinceField.ref}
                                      onBlur={provinceField.onBlur}
                                      aria-invalid={provinceField['aria-invalid']}
                                      aria-describedby={provinceField['aria-describedby']}
                                      options={provinces}
                                      selected={formProvinceId}
                                      loading={loadingProvinces}
                                      disabled={!provinceOptions.ready || savingAddress}
                                      onChange={(id) => {
                                        if (id === formProvinceId) return;
                                        setFormProvinceId(id);
                                        setFormCityId('');
                                      }}
                                    />
                                    {addressFieldError('formProvinceId')}
                                  </div>

                                  <div className="min-w-0 space-y-1">
                                    <label
                                      htmlFor="order-address-city"
                                      className="block text-sm font-medium"
                                    >
                                      {addressFormText('settings.addresses.form.city', locale)}
                                    </label>
                                    <GeographyPicker
                                      key={formProvinceId}
                                      id="order-address-city"
                                      kind="city"
                                      locale={locale}
                                      inputRef={cityField.ref}
                                      onBlur={cityField.onBlur}
                                      aria-invalid={cityField['aria-invalid']}
                                      aria-describedby={cityField['aria-describedby']}
                                      options={cities}
                                      selected={formCityId}
                                      hasProvince={!!formProvinceId}
                                      loading={loadingCities}
                                      disabled={!cityOptions.ready || savingAddress}
                                      onChange={setFormCityId}
                                    />
                                    {addressFieldError('formCityId')}
                                  </div>
                                </div>

                                <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.45fr)]">
                                  <div className="min-w-0 space-y-1">
                                    <label
                                      htmlFor="order-address-fullAddress"
                                      className="block text-sm font-medium"
                                    >
                                      {addressFormText(
                                        'settings.addresses.form.fullAddress',
                                        locale
                                      )}
                                    </label>
                                    <Textarea
                                      id="order-address-fullAddress"
                                      {...bindAddressField('formFullAddress')}
                                      disabled={savingAddress}
                                      value={formFullAddress}
                                      onChange={(e) => setFormFullAddress(e.target.value)}
                                      autoComplete="street-address"
                                      placeholder={addressesText('streetExample', locale)}
                                      rows={2}
                                      className="min-h-16 resize-y"
                                      maxLength={500}
                                    />
                                    {addressFieldError('formFullAddress')}
                                  </div>

                                  <div className="min-w-0 space-y-1">
                                    <label
                                      htmlFor="order-address-postalCode"
                                      className="block text-sm font-medium"
                                    >
                                      {addressFormText(
                                        'settings.addresses.form.postalCode',
                                        locale
                                      )}
                                    </label>
                                    <Input
                                      type="text"
                                      autoComplete="postal-code"
                                      inputMode="numeric"
                                      id="order-address-postalCode"
                                      {...bindAddressField('formPostalCode')}
                                      disabled={savingAddress}
                                      value={formPostalCode}
                                      onChange={(e) => setFormPostalCode(e.target.value)}
                                      dir="ltr"
                                      maxLength={10}
                                    />
                                    {addressFieldError('formPostalCode')}
                                  </div>
                                </div>

                                <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={savingAddress}
                                    onClick={() => {
                                      clearNewAddress();
                                      requestAnimationFrame(() =>
                                        addAddressButton.current?.focus()
                                      );
                                    }}
                                  >
                                    {t('electricity.order.cancel', locale)}
                                  </Button>
                                  <Button
                                    type="button"
                                    onClick={handleSaveNewAddress}
                                    disabled={
                                      savingAddress ||
                                      loadingProvinces ||
                                      provinceError ||
                                      loadingCities ||
                                      cityError
                                    }
                                    className="gap-2"
                                  >
                                    {savingAddress ? (
                                      <Loader2Icon className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <CheckIcon className="h-4 w-4" />
                                    )}
                                    {savingAddress
                                      ? addressFormText('settings.addresses.form.saving', locale)
                                      : t('electricity.order.saveAndUse', locale)}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                  <div className="contents lg:sticky lg:top-4 lg:block lg:min-w-0 lg:rounded-xl lg:border lg:border-primary/20">
                    <aside aria-labelledby="electricity-quote-heading" className="min-w-0">
                      <Card
                        size="sm"
                        className="bg-primary/5 ring-primary/20 lg:rounded-b-none lg:shadow-none lg:ring-0"
                      >
                        <CardContent className="space-y-3">
                          <h2 id="electricity-quote-heading" className="text-lg font-semibold">
                            {t('electricity.order.step3', locale)}
                          </h2>
                          <div aria-live="polite" aria-atomic="true">
                            {quoteErrorNotice ??
                              (quoting ? (
                                <p className="text-sm text-muted-foreground">
                                  {t('electricity.order.previewLoading', locale)}
                                </p>
                              ) : quote ? (
                                <p className="text-2xl font-bold tabular-nums sm:text-3xl">
                                  <bdi>{numbers.money(quote.totalIrR)}</bdi>
                                </p>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  {simpleElectricityOrderText('quotePrompt', locale)}
                                </p>
                              ))}
                          </div>
                          {quote && (
                            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-t pt-3 text-sm">
                              <dt>{t('electricity.order.vat', locale)}</dt>
                              <dd>
                                <bdi>{numbers.money(quote.vatIrR)}</bdi>
                              </dd>
                              <dt>{t('electricity.order.discount', locale)}</dt>
                              <dd>
                                <bdi>{numbers.money(quote.discountIrR)}</bdi>
                              </dd>
                            </dl>
                          )}
                          {quote?.greenRuleApplies && (
                            <p className="text-sm">
                              {t('electricity.order.mandatoryGreen', locale)}
                            </p>
                          )}
                          <p className="text-sm text-muted-foreground">
                            {simpleElectricityOrderText('quotePaymentTiming', locale)}
                          </p>
                        </CardContent>
                      </Card>
                    </aside>
                    {actions}
                  </div>
                </div>
              )}

              {step === 2 && (
                <SimpleReview
                  quote={quote}
                  quoting={quoting}
                  quoteErrorNotice={periodReadFeedback || quoteErrorNotice}
                  calendarLabels={calendarLabels}
                  requestedKwh={totalKwh}
                  formatPeriod={periodDates}
                  appliedGiftCode={appliedGiftCode}
                  activeProfileName={activeProfileName}
                  activeProfileId={activeProfileId}
                  productName={productTitle(selectedProduct)}
                  deliveryAddress={
                    selectedAddress
                      ? `${getProvinceName(selectedAddress.provinceId)}، ${getCityName(selectedAddress.cityId)} — ${selectedAddress.fullAddress}`
                      : ''
                  }
                  postalCode={selectedAddress?.postalCode ?? ''}
                  editDisabled={
                    held ||
                    savingDraft ||
                    submitting ||
                    savingAddress ||
                    draftLoading ||
                    draftError ||
                    completed.current
                  }
                  onEdit={(section) => {
                    const targets: Record<number, string> = {
                      1: 'electricity-period',
                      2: 'electricity-kwh',
                      3: 'electricity-kwh',
                      4: 'electricity-gift-details',
                      5: 'electricity-address-title',
                    };
                    setEditTarget(targets[section]);
                    void saveDraft(false, 1);
                  }}
                />
              )}
              {step === 2 && <ConfirmationFields gate={financialGate} disabled={submitting} />}
            </fieldset>
          )}
        </ValidatedFormWizard>
      </Suspense>
    </div>
  );
}
