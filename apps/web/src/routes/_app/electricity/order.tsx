import { useNumberFormatting } from '../../../hooks/useNumberFormatting.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import { createFileRoute, useBlocker, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { t } from '@barghsa/i18n/app';
import { MapPinIcon, PlusIcon, Loader2Icon, CheckIcon, HomeIcon, PackageIcon } from 'lucide-react';
import { Button, Card, CardContent, Dialog, DialogContent, DialogTitle } from '@barghsa/ui';
import { withCsrf } from '../../../lib/csrf.js';
import { useLocale } from '../../../hooks/useLocale.js';
import { FormWizard } from '../../../components/FormWizard.js';
import { WalletFundingPrompt } from '../../../components/WalletFundingPrompt.js';

export const Route = createFileRoute('/_app/electricity/order')({
  component: ElectricityOrderPage,
});

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

interface Address {
  id: string;
  profileId: string;
  provinceId: string;
  cityId: string;
  fullAddress: string;
  postalCode: string;
  mainAddress: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Province {
  id: string;
  nameFa: string;
  nameEn: string;
}

interface City {
  id: string;
  provinceId: string;
  nameFa: string;
  nameEn: string;
}

type SimplePeriod =
  'current_month' | 'next_month' | 'current_week' | 'next_week' | 'week_after_next';
interface PeriodOption {
  key: SimplePeriod;
  start: string;
  end: string;
}
interface PriceQuote {
  reviewDigest: string;
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
const stepKeys = [
  'electricity.order.step1',
  'electricity.order.step2',
  'electricity.order.step3',
  'electricity.order.step4',
  'electricity.order.step5',
] as const;

function periodDates(option: PeriodOption, locale: 'fa' | 'en') {
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
  return `${persian.format(start)} – ${persian.format(end)} · ${gregorian.format(start)} – ${gregorian.format(end)}`;
}

// ─── Page Component ────────────────────────────────────────────────────

function ElectricityOrderPage() {
  const locale = useLocale();
  const navigate = useNavigate();
  const numbers = useNumberFormatting(locale);

  // Profile & verification
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const verificationGeneration = useRef(0);
  const [verificationError, setVerificationError] = useState(false);
  const [checking, setChecking] = useState(true);
  const [blocked, setBlocked] = useState<boolean | null>(null);

  // Products
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productError, setProductError] = useState(false);
  const productGeneration = useRef(0);

  // Addresses
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [addressTouched, setAddressTouched] = useState(false);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [addressError, setAddressError] = useState(false);
  const addressGeneration = useRef(0);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [provinceError, setProvinceError] = useState(false);
  const [loadingProvinces, setLoadingProvinces] = useState(true);
  const provinceGeneration = useRef(0);
  const [cityError, setCityError] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [cities, setCities] = useState<City[]>([]);
  const cityGeneration = useRef(0);
  /** City name lookup map: cityId -> { nameFa, nameEn } */
  const [cityMap, setCityMap] = useState<Record<string, { nameFa: string; nameEn: string }>>({});

  // New address form
  const [showNewAddressForm, setShowNewAddressForm] = useState(false);
  const [formProvinceId, setFormProvinceId] = useState('');
  const [formCityId, setFormCityId] = useState('');
  const [formFullAddress, setFormFullAddress] = useState('');
  const [formPostalCode, setFormPostalCode] = useState('');
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
  const [period, setPeriod] = useState<SimplePeriod>('current_month');
  const [totalKwh, setTotalKwh] = useState('');
  const [billSuggestion, setBillSuggestion] = useState<BillSuggestion | null>(null);
  const [giftCode, setGiftCode] = useState('');
  const [appliedGiftCode, setAppliedGiftCode] = useState('');
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [quoteError, setQuoteError] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quoteVersion, setQuoteVersion] = useState(0);
  const submissionKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [draftLoading, setDraftLoading] = useState(true);
  const [draftError, setDraftError] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftRetry, setDraftRetry] = useState(0);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const savedDraftSignature = useRef(JSON.stringify(['current_month', '', '', '', '']));

  const inputSignature = () =>
    JSON.stringify([
      period,
      totalKwh,
      giftCode,
      appliedGiftCode,
      addressTouched ? selectedAddressId : '',
    ]);
  const unsavedChanges =
    !draftLoading && !orderCreated && inputSignature() !== savedDraftSignature.current;
  const blocker = useBlocker({
    shouldBlockFn: () => unsavedChanges,
    withResolver: true,
    disabled: !unsavedChanges,
  });

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
    setVerificationError(false);
    try {
      const response = await fetch('/api/profiles/verification-status', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Verification unavailable');
      const data = await response.json();
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
  }, []);

  // ── Fetch products ──────────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    const current = ++productGeneration.current;
    setLoadingProducts(true);
    setProductError(false);
    setProducts([]);
    setSelectedProductId('');
    try {
      const res = await fetch('/api/products/electricity');
      if (!res.ok) throw new Error('Products unavailable');
      const data: unknown = await res.json();
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
  }, []);

  // ── Fetch addresses ─────────────────────────────────────────────────

  const fetchAddresses = useCallback(async () => {
    const current = ++addressGeneration.current;
    setLoadingAddresses(true);
    setAddressError(false);
    setAddresses([]);
    setSelectedAddressId('');
    if (!activeProfileId) {
      setLoadingAddresses(false);
      return;
    }
    try {
      const res = await fetch(`/api/profiles/${activeProfileId}/addresses`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Addresses unavailable');
      const data = await res.json();
      if (
        !Array.isArray(data?.addresses) ||
        data.addresses.some(
          (address: unknown) =>
            !address ||
            typeof address !== 'object' ||
            ['id', 'provinceId', 'cityId', 'fullAddress', 'postalCode'].some(
              (key) => typeof (address as Record<string, unknown>)[key] !== 'string'
            )
        )
      )
        throw new Error('Invalid addresses');
      if (current !== addressGeneration.current) return;
      const items: Address[] = data.addresses;
      setAddresses(items);
      setSelectedAddressId((current) =>
        items.some((address) => address.id === current)
          ? current
          : ((items.find((address) => address.mainAddress) ?? items[0])?.id ?? '')
      );
    } catch {
      if (current === addressGeneration.current) setAddressError(true);
    } finally {
      if (current === addressGeneration.current) setLoadingAddresses(false);
    }
  }, [activeProfileId]);

  // ── Fetch provinces ─────────────────────────────────────────────────

  const fetchProvinces = useCallback(async () => {
    const current = ++provinceGeneration.current;
    setLoadingProvinces(true);
    setProvinceError(false);
    setProvinces([]);
    try {
      const res = await fetch('/api/geography/provinces');
      if (!res.ok) throw new Error('Provinces unavailable');
      const data: unknown = await res.json();
      if (
        !Array.isArray(data) ||
        data.some(
          (place) =>
            !place || ['id', 'nameFa', 'nameEn'].some((key) => typeof place[key] !== 'string')
        )
      )
        throw new Error('Invalid provinces');
      if (current === provinceGeneration.current) setProvinces(data);
    } catch {
      if (current === provinceGeneration.current) setProvinceError(true);
    } finally {
      if (current === provinceGeneration.current) setLoadingProvinces(false);
    }
  }, []);

  // ── Fetch cities for a province ─────────────────────────────────────

  const fetchCities = useCallback(async (provinceId: string, updateForm = true) => {
    const current = updateForm ? ++cityGeneration.current : null;
    if (updateForm) {
      setCities([]);
      setFormCityId('');
      setCityError(false);
      setLoadingCities(true);
    }
    try {
      const res = await fetch(`/api/geography/provinces/${provinceId}/cities`);
      if (!res.ok) throw new Error('Cities unavailable');
      const data: unknown = await res.json();
      if (
        !Array.isArray(data) ||
        data.some(
          (place) =>
            !place ||
            place.provinceId !== provinceId ||
            ['id', 'nameFa', 'nameEn'].some((key) => typeof place[key] !== 'string')
        )
      )
        throw new Error('Invalid cities');
      if (current !== null && current === cityGeneration.current) setCities(data);
      setCityMap((prev) => {
        const next = { ...prev };
        for (const city of data) next[city.id] = { nameFa: city.nameFa, nameEn: city.nameEn };
        return next;
      });
    } catch {
      if (current !== null && current === cityGeneration.current) setCityError(true);
    } finally {
      if (current !== null && current === cityGeneration.current) setLoadingCities(false);
    }
  }, []);

  // ── Effects ─────────────────────────────────────────────────────────

  useEffect(() => {
    checkVerification();
    fetchProducts();
    fetchProvinces();
    return () => {
      ++verificationGeneration.current;
      ++productGeneration.current;
      ++provinceGeneration.current;
    };
  }, [checkVerification, fetchProducts, fetchProvinces]);

  useEffect(() => {
    void fetchAddresses();
    return () => {
      ++addressGeneration.current;
    };
  }, [fetchAddresses]);

  useEffect(() => {
    if (formProvinceId) {
      fetchCities(formProvinceId);
    } else {
      ++cityGeneration.current;
      setCityError(false);
      setLoadingCities(false);
      setCities([]);
      setFormCityId('');
    }
    return () => {
      ++cityGeneration.current;
    };
  }, [formProvinceId, fetchCities]);

  // Fetch cities for each unique province referenced by existing addresses
  useEffect(() => {
    const uniqueProvinceIds = [...new Set(addresses.map((a) => a.provinceId))];
    for (const pid of uniqueProvinceIds) {
      fetchCities(pid, false);
    }
  }, [addresses, fetchCities]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/electricity/periods/simple', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Periods unavailable');
        const data: unknown = await response.json();
        if (
          !data ||
          typeof data !== 'object' ||
          !('periods' in data) ||
          !Array.isArray(data.periods)
        )
          throw new Error('Invalid periods');
        if (!controller.signal.aborted) {
          setPeriodOptions(data.periods as PeriodOption[]);
          setLoadingPeriods(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPeriodOptions([]);
          setLoadingPeriods(false);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!activeProfileId) return;
    const controller = new AbortController();
    setBillSuggestion(null);
    void fetch(`/api/electricity/bill-data/${activeProfileId}?period=${period}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Bill data unavailable');
        return response.json() as Promise<BillSuggestion>;
      })
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
  }, [activeProfileId, period]);

  useEffect(() => {
    if (!activeProfileId) return;
    const controller = new AbortController();
    setDraftLoading(true);
    setDraftError(false);
    void fetch(`/api/electricity/drafts/simple?profileId=${activeProfileId}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Draft unavailable');
        return response.json() as Promise<{
          currentStep: number;
          data: {
            period: SimplePeriod;
            totalKwh?: string;
            giftCode?: string;
            giftCodeInput?: string;
            addressId?: string;
          } | null;
        }>;
      })
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
              !Object.hasOwn(periodLabels, draft.data.period) ||
              (draft.data.totalKwh !== undefined && !/^[1-9]\d*$/.test(draft.data.totalKwh)) ||
              (draft.data.giftCode !== undefined && typeof draft.data.giftCode !== 'string') ||
              (draft.data.giftCodeInput !== undefined &&
                typeof draft.data.giftCodeInput !== 'string') ||
              (draft.data.addressId !== undefined && typeof draft.data.addressId !== 'string')))
        )
          throw new Error('Invalid draft');
        if (draft.data) {
          setPeriod(draft.data.period);
          setTotalKwh(draft.data.totalKwh ?? '');
          setGiftCode(draft.data.giftCodeInput ?? draft.data.giftCode ?? '');
          setAppliedGiftCode(draft.data.giftCode ?? '');
          if (draft.data.addressId) setSelectedAddressId(draft.data.addressId);
        }
        setAddressTouched(Boolean(draft.data?.addressId));
        savedDraftSignature.current = JSON.stringify([
          draft.data?.period ?? 'current_month',
          draft.data?.totalKwh ?? '',
          draft.data?.giftCodeInput ?? draft.data?.giftCode ?? '',
          draft.data?.giftCode ?? '',
          draft.data?.addressId ?? '',
        ]);
        const requestedStep = Number(new URLSearchParams(window.location.search).get('step'));
        setStep(
          (Number.isInteger(requestedStep) &&
          requestedStep >= 1 &&
          requestedStep <= draft.currentStep
            ? requestedStep
            : draft.currentStep) as 1 | 2 | 3 | 4 | 5
        );
        setDraftLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDraftError(true);
          setDraftLoading(false);
        }
      });
    return () => controller.abort();
  }, [activeProfileId, draftRetry]);

  useEffect(() => {
    if (draftLoading || !activeProfileId || orderCreated) return;
    const url = new URL(window.location.href);
    url.searchParams.set('step', String(step));
    window.history.replaceState(window.history.state, '', url);
  }, [step, draftLoading, activeProfileId, orderCreated]);

  useEffect(() => {
    if (step !== 5 || !activeProfileId) return;
    const controller = new AbortController();
    setWalletBalance(null);
    void fetch(`/api/wallet/${activeProfileId}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Wallet unavailable');
        return response.json() as Promise<{ balance: string }>;
      })
      .then((wallet) => {
        if (!controller.signal.aborted) setWalletBalance(wallet.balance);
      })
      .catch(() => {
        if (!controller.signal.aborted) setWalletBalance(null);
      });
    return () => controller.abort();
  }, [step, activeProfileId]);

  useEffect(() => {
    const selected = products.find((item) => item.id === selectedProductId);
    const validQuantity =
      /^[1-9]\d*$/.test(totalKwh) &&
      !!selected &&
      (selected.limits.minKwh === '0' || BigInt(totalKwh) >= BigInt(selected.limits.minKwh)) &&
      (selected.limits.maxKwh === '0' || BigInt(totalKwh) <= BigInt(selected.limits.maxKwh));
    if (!activeProfileId || !validQuantity) {
      setQuote(null);
      setQuoting(false);
      return;
    }
    const controller = new AbortController();
    setQuote(null);
    setQuoteError(false);
    setQuoting(true);
    const timer = window.setTimeout(() => {
      void fetch('/api/electricity/preview/simple', {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          profileId: activeProfileId,
          period,
          totalKwh,
          ...(appliedGiftCode ? { giftCode: appliedGiftCode } : {}),
        }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('Quote unavailable');
          return response.json() as Promise<PriceQuote>;
        })
        .then((data) => {
          if (!controller.signal.aborted) setQuote(data);
        })
        .catch(() => {
          if (!controller.signal.aborted) setQuoteError(true);
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
  const selectedProduct = products.find((item) => item.id === selectedProductId);
  const quantityError =
    totalKwh !== '' &&
    (!/^[1-9]\d*$/.test(totalKwh) ||
      (!!selectedProduct &&
        ((selectedProduct.limits.minKwh !== '0' &&
          BigInt(totalKwh) < BigInt(selectedProduct.limits.minKwh)) ||
          (selectedProduct.limits.maxKwh !== '0' &&
            BigInt(totalKwh) > BigInt(selectedProduct.limits.maxKwh)))));

  // ── Save new address ─────────────────────────────────────────────────

  const handleSaveNewAddress = useCallback(async () => {
    if (addressSaveInFlight.current) return;
    if (checking || blocked !== false || verificationError || loadingAddresses || addressError)
      return;
    if (
      loadingProvinces ||
      provinceError ||
      loadingCities ||
      cityError ||
      !provinces.some((province) => province.id === formProvinceId) ||
      !cities.some((city) => city.id === formCityId && city.provinceId === formProvinceId)
    )
      return;
    if (!formProvinceId || !formCityId || !formFullAddress.trim() || !formPostalCode.trim()) {
      toast.error(t('settings.addresses.error.create', locale));
      return;
    }

    if (!activeProfileId) return;

    addressSaveInFlight.current = true;
    const generation = addressGeneration.current;
    const input = {
      provinceId: formProvinceId,
      cityId: formCityId,
      fullAddress: formFullAddress.trim(),
      postalCode: formPostalCode.trim(),
    };
    setSavingAddress(true);
    try {
      const res = await fetch(`/api/profiles/${activeProfileId}/addresses`, {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        toast.error(t('settings.addresses.error.create', locale));
        return;
      }

      const newAddress: Address = await res.json();
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
      toast.success(t('settings.addresses.success.create', locale));

      // Add to list and select it
      setAddresses((prev) => [...prev, newAddress]);
      setSelectedAddressId(newAddress.id);
      setAddressTouched(true);
      setShowNewAddressForm(false);

      // Reset form
      setFormProvinceId('');
      setFormCityId('');
      setFormFullAddress('');
      setFormPostalCode('');
    } catch {
      toast.error(t('settings.addresses.error.create', locale));
    } finally {
      addressSaveInFlight.current = false;
      setSavingAddress(false);
    }
  }, [
    formProvinceId,
    loadingProvinces,
    provinceError,
    loadingCities,
    cityError,
    provinces,
    cities,
    formCityId,
    formFullAddress,
    formPostalCode,
    activeProfileId,
    locale,
    checking,
    blocked,
    verificationError,
    loadingAddresses,
    addressError,
  ]);

  const saveDraft = async (advance: boolean) => {
    if (savingDraft || !activeProfileId || (advance && step >= 5)) return false;
    if (advance && step === 1 && (!selectedProduct || periodOptions.length === 0)) return false;
    if (advance && step === 2 && (!/^[1-9]\d*$/.test(totalKwh) || quantityError)) {
      toast.error(t('electricity.order.quantityInvalid', locale));
      return false;
    }
    if (advance && step >= 3 && (!quote || quoting || quoteError)) {
      toast.error(t('electricity.order.previewUnavailable', locale));
      return false;
    }
    if (advance && step === 4 && giftCode.trim() !== appliedGiftCode) {
      toast.error(t('electricity.order.applyGiftFirst', locale));
      return false;
    }
    setSavingDraft(true);
    const savedStep = advance ? step + 1 : step;
    try {
      const response = await fetch('/api/electricity/drafts/simple', {
        method: 'PUT',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          profileId: activeProfileId,
          currentStep: savedStep,
          data: {
            period,
            ...(totalKwh ? { totalKwh } : {}),
            ...(appliedGiftCode ? { giftCode: appliedGiftCode } : {}),
            ...(giftCode ? { giftCodeInput: giftCode } : {}),
            ...(addressTouched && selectedAddressId ? { addressId: selectedAddressId } : {}),
          },
        }),
      });
      if (!response.ok) throw new Error('Draft save failed');
      const saved: unknown = await response.json();
      if (
        !saved ||
        typeof saved !== 'object' ||
        !('currentStep' in saved) ||
        saved.currentStep !== savedStep
      )
        throw new Error('Invalid saved draft');
      savedDraftSignature.current = inputSignature();
      if (advance) setStep(savedStep as 2 | 3 | 4 | 5);
      else toast.success(t('electricity.order.draftSaved', locale));
      return true;
    } catch {
      toast.error(t('electricity.order.draftSaveFailed', locale));
      return false;
    } finally {
      setSavingDraft(false);
    }
  };

  // ── Submit order ────────────────────────────────────────────────────

  const handleSubmitOrder = useCallback(async () => {
    if (orderSaveInFlight.current || addressSaveInFlight.current || showNewAddressForm) return;
    if (
      loadingProducts ||
      productError ||
      !products.some((product) => product.id === selectedProductId)
    )
      return;
    if (checking || blocked !== false || verificationError || loadingAddresses || addressError)
      return;
    if (!selectedProductId) {
      toast.error(t('electricity.order.error.noProduct', locale));
      return;
    }
    if (!selectedAddressId || !selectedAddress) {
      toast.error(t('electricity.order.error.noAddress', locale));
      return;
    }
    if (!activeProfileId) {
      toast.error(t('electricity.order.error.noProfile', locale));
      return;
    }
    if (!quote || quoting || quoteError) {
      toast.error(t('electricity.order.previewUnavailable', locale));
      return;
    }

    orderSaveInFlight.current = true;
    setSubmitting(true);
    const generation = verificationGeneration.current;
    const fingerprint = JSON.stringify({
      activeProfileId,
      period,
      totalKwh,
      appliedGiftCode,
      selectedAddressId,
    });
    if (submissionKey.current?.fingerprint !== fingerprint) {
      submissionKey.current = { fingerprint, key: crypto.randomUUID() };
    }
    const input = {
      profileId: activeProfileId,
      period,
      totalKwh,
      idempotencyKey: submissionKey.current.key,
      expectedQuoteDigest: quote.reviewDigest,
      ...(appliedGiftCode ? { giftCode: appliedGiftCode } : {}),
      address: {
        provinceId: selectedAddress.provinceId,
        cityId: selectedAddress.cityId,
        fullAddress: selectedAddress.fullAddress,
        postalCode: selectedAddress.postalCode,
      },
    };
    try {
      const res = await fetch('/api/electricity/orders/simple', {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        if (res.status === 409) setQuoteVersion((version) => version + 1);
        const errBody = await res.json().catch(() => ({}));
        const message = (errBody as { message?: string }).message;
        toast.error(message || t('electricity.order.error.create', locale));
        return;
      }

      const result: unknown = await res.json();
      if (generation !== verificationGeneration.current) return;
      if (
        !result ||
        typeof result !== 'object' ||
        !('orderId' in result) ||
        typeof result.orderId !== 'string' ||
        !('contractId' in result) ||
        typeof result.contractId !== 'string' ||
        !('invoiceId' in result) ||
        typeof result.invoiceId !== 'string'
      )
        throw new Error('Invalid saved order');
      setOrderCreated({
        orderId: result.orderId,
        contractId: result.contractId,
        invoiceId: result.invoiceId,
      });
      toast.success(t('electricity.order.success.create', locale));
    } catch {
      toast.error(t('electricity.order.error.create', locale));
    } finally {
      orderSaveInFlight.current = false;
      setSubmitting(false);
    }
  }, [
    selectedProductId,
    showNewAddressForm,
    products,
    loadingProducts,
    productError,
    selectedAddressId,
    selectedAddress,
    activeProfileId,
    locale,
    checking,
    blocked,
    verificationError,
    loadingAddresses,
    addressError,
    period,
    totalKwh,
    appliedGiftCode,
    quote,
    quoting,
    quoteError,
  ]);

  // ── Render: Loading ─────────────────────────────────────────────────

  if (checking) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p role="status" className="text-muted-foreground">
          {t('electricity.order.checking', locale)}
        </p>
      </div>
    );
  }

  if (verificationError || (blocked === false && !activeProfileId)) {
    return (
      <div
        className="container mx-auto max-w-md space-y-4 p-6"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
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
            {t('verification.order.blocked.title', locale)}
          </h1>
          <p className="mb-6 text-muted-foreground">
            {t('verification.order.blocked.description', locale)}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('verification.order.blocked.support', locale)}
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
              href={`/contracts?contractId=${encodeURIComponent(orderCreated.contractId)}`}
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

  return (
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset();
        }}
      >
        <DialogContent>
          <DialogTitle>{t('electricity.order.unsaved.title', locale)}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('electricity.order.unsaved.description', locale)}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => blocker.status === 'blocked' && blocker.reset()}
            >
              {t('electricity.order.unsaved.stay', locale)}
            </Button>
            <Button
              variant="outline"
              onClick={() => blocker.status === 'blocked' && blocker.proceed()}
            >
              {t('electricity.order.unsaved.leave', locale)}
            </Button>
            <Button
              onClick={async () => {
                if ((await saveDraft(false)) && blocker.status === 'blocked') blocker.proceed();
              }}
            >
              {t('electricity.order.unsaved.saveAndLeave', locale)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <h1 className="mb-2 text-2xl font-bold">{t('electricity.order.title', locale)}</h1>
      <p className="mb-6 text-muted-foreground">{t('electricity.order.description', locale)}</p>
      <FormWizard
        steps={stepKeys.map((key) => t(key, locale))}
        step={step}
        ariaLabel={t('electricity.order.steps', locale)}
        backLabel={t('electricity.order.back', locale)}
        saveLabel={t('electricity.order.saveDraft', locale)}
        nextLabel={t('electricity.order.next', locale)}
        submitLabel={t('electricity.order.submit', locale)}
        savingLabel={t('electricity.order.savingDraft', locale)}
        submittingLabel={t('electricity.order.submitting', locale)}
        saving={savingDraft}
        submitting={submitting}
        saveDisabled={draftLoading || draftError || quantityError || savingAddress}
        nextDisabled={
          draftLoading ||
          (step === 1 && (!selectedProduct || periodOptions.length === 0)) ||
          (step === 2 && (!totalKwh || quantityError)) ||
          (step >= 3 && (!quote || quoting || quoteError)) ||
          (step === 4 && giftCode.trim() !== appliedGiftCode)
        }
        submitDisabled={
          draftLoading ||
          draftError ||
          savingDraft ||
          savingAddress ||
          showNewAddressForm ||
          loadingAddresses ||
          addressError ||
          !selectedProductId ||
          !selectedAddressId ||
          !quote ||
          quoting ||
          periodOptions.length === 0
        }
        onBack={() => setStep((current) => Math.max(1, current - 1) as 1 | 2 | 3 | 4 | 5)}
        onSave={() => void saveDraft(false)}
        onNext={() => void saveDraft(true)}
        onSubmit={() => void handleSubmitOrder()}
      >
        {/* Step 1: Select Product */}
        {step === 1 && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
                <PackageIcon className="h-5 w-5" />
                {t('electricity.order.selectProduct', locale)}
              </h2>

              {loadingProducts ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  {t('electricity.order.loadingProducts', locale)}
                </div>
              ) : productError ? (
                <div className="space-y-3" role="alert">
                  <p>{t('electricity.order.productLoadFailed', locale)}</p>
                  <Button onClick={() => void fetchProducts()}>
                    {t('electricity.order.retry', locale)}
                  </Button>
                </div>
              ) : products.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('electricity.order.noProducts', locale)}
                </p>
              ) : (
                <div className="space-y-2">
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
                        name="product"
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

        {(step === 1 || step === 2 || step === 4) && (
          <Card className="mb-6">
            <CardContent className="space-y-5 pt-6">
              <h2 className="text-lg font-semibold">
                {t(
                  step === 1
                    ? 'electricity.order.period.title'
                    : step === 2
                      ? 'electricity.order.quantity'
                      : 'electricity.order.giftCode',
                  locale
                )}
              </h2>
              {step === 1 && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="electricity-period-type"
                        className="mb-1 block text-sm font-medium"
                      >
                        {t('electricity.order.period.type', locale)}
                      </label>
                      <select
                        id="electricity-period-type"
                        value={period.includes('month') ? 'monthly' : 'weekly'}
                        disabled={submitting}
                        onChange={(event) =>
                          setPeriod(
                            event.target.value === 'monthly' ? 'current_month' : 'current_week'
                          )
                        }
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="monthly">
                          {t('electricity.order.period.monthly', locale)}
                        </option>
                        <option value="weekly">
                          {t('electricity.order.period.weekly', locale)}
                        </option>
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="electricity-period"
                        className="mb-1 block text-sm font-medium"
                      >
                        {t('electricity.order.period.selection', locale)}
                      </label>
                      <select
                        id="electricity-period"
                        value={period}
                        disabled={submitting || periodOptions.length === 0}
                        onChange={(event) => setPeriod(event.target.value as SimplePeriod)}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      >
                        {periodOptions
                          .filter((option) =>
                            period.includes('month')
                              ? option.key.includes('month')
                              : option.key.includes('week')
                          )
                          .map((option) => (
                            <option key={option.key} value={option.key}>
                              {t(periodLabels[option.key], locale)} ·{' '}
                              {new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
                                timeZone: 'Asia/Tehran',
                                month: 'long',
                                year: 'numeric',
                              }).format(new Date(option.start))}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                  {periodOptions.find((option) => option.key === period) ? (
                    <p className="text-sm text-muted-foreground">
                      {periodDates(
                        periodOptions.find((option) => option.key === period)!,
                        locale
                      )}
                    </p>
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      {t(
                        loadingPeriods
                          ? 'electricity.order.period.loading'
                          : 'electricity.order.period.unavailable',
                        locale
                      )}
                    </p>
                  )}
                </>
              )}
              {step === 2 && (
                <>
                  <div>
                    <label htmlFor="electricity-kwh" className="mb-1 block text-sm font-medium">
                      {t('electricity.order.quantity', locale)}
                    </label>
                    <input
                      id="electricity-kwh"
                      type="text"
                      inputMode="numeric"
                      pattern="[1-9][0-9]*"
                      value={totalKwh}
                      disabled={submitting}
                      onChange={(event) => setTotalKwh(event.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      aria-describedby="electricity-kwh-hint"
                      aria-invalid={quantityError}
                    />
                    <p id="electricity-kwh-hint" className="mt-1 text-xs text-muted-foreground">
                      {t('electricity.order.quantityHint', locale)}{' '}
                      {selectedProduct &&
                        `${selectedProduct.limits.minKwh}–${selectedProduct.limits.maxKwh === '0' ? '∞' : selectedProduct.limits.maxKwh} kWh`}
                    </p>
                    {quantityError && (
                      <p role="alert" className="mt-1 text-sm text-destructive">
                        {t('electricity.order.quantityInvalid', locale)}
                      </p>
                    )}
                  </div>
                  {billSuggestion?.available && billSuggestion.suggestedKwh ? (
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <p>
                        {t('electricity.order.estimate', locale)}:{' '}
                        {numbers.number(BigInt(billSuggestion.suggestedKwh))} kWh
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setTotalKwh(billSuggestion.suggestedKwh!)}
                      >
                        {t('electricity.order.useEstimate', locale)}
                      </Button>
                      <p className="w-full text-xs text-muted-foreground">
                        {billSuggestion.dataSource} · {billSuggestion.dataPeriod?.start} –{' '}
                        {billSuggestion.dataPeriod?.end} ·{billSuggestion.dataTimestamp} ·
                        {Math.round((billSuggestion.coverage ?? 0) * 100)}%{' '}
                        {t('electricity.order.coverage', locale)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t('electricity.order.manualQuantity', locale)}
                    </p>
                  )}
                </>
              )}
              {step === 4 && (
                <>
                  <div>
                    <label htmlFor="electricity-gift" className="mb-1 block text-sm font-medium">
                      {t('electricity.order.giftCode', locale)}
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="electricity-gift"
                        type="text"
                        value={giftCode}
                        disabled={submitting}
                        onChange={(event) => setGiftCode(event.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={submitting}
                        onClick={() => setAppliedGiftCode(giftCode.trim())}
                      >
                        {t('electricity.order.applyGift', locale)}
                      </Button>
                    </div>
                  </div>
                  {appliedGiftCode && quote && (
                    <p className="text-sm text-primary">
                      {t('electricity.order.discount', locale)}: {numbers.money(quote.discountIrR)}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 2: Select Address */}
        {step === 5 && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
                <MapPinIcon className="h-5 w-5" />
                {t('electricity.order.selectAddress', locale)}
              </h2>

              {loadingAddresses ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  {t('electricity.order.loadingAddresses', locale)}
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
                    disabled={submitting}
                    onClick={() => setShowNewAddressForm(true)}
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
                            name="address"
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
                                {getProvinceName(address.provinceId)}، {getCityName(address.cityId)}
                              </span>
                              {address.mainAddress && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-0.5">
                                  <HomeIcon className="h-3 w-3" />
                                  {t('electricity.order.mainAddress', locale)}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground truncate">
                              {address.fullAddress}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t('electricity.order.postalCode', locale)}: {address.postalCode}
                            </p>
                          </div>
                        </label>
                      ))}

                      <Button
                        variant="outline"
                        disabled={submitting}
                        onClick={() => setShowNewAddressForm(true)}
                        className="w-full gap-2 mt-2"
                      >
                        <PlusIcon className="h-4 w-4" />
                        {t('electricity.order.addNewAddress', locale)}
                      </Button>
                    </div>
                  )}

                  {/* New address form */}
                  {showNewAddressForm && (
                    <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
                      <h3 className="text-sm font-medium">
                        {t('electricity.order.newAddressTitle', locale)}
                      </h3>

                      {provinceError && (
                        <div role="alert" className="space-y-2">
                          <p>{t('electricity.order.provinceLoadFailed', locale)}</p>
                          <Button onClick={() => void fetchProvinces()}>
                            {t('electricity.order.retry', locale)}
                          </Button>
                        </div>
                      )}
                      {cityError && (
                        <div role="alert" className="space-y-2">
                          <p>{t('electricity.order.cityLoadFailed', locale)}</p>
                          <Button onClick={() => void fetchCities(formProvinceId)}>
                            {t('electricity.order.retry', locale)}
                          </Button>
                        </div>
                      )}
                      {/* Province */}
                      <div>
                        <label
                          htmlFor="order-address-province"
                          className="block text-sm font-medium mb-1"
                        >
                          {t('settings.addresses.form.province', locale)}
                        </label>
                        <select
                          id="order-address-province"
                          disabled={loadingProvinces || provinceError || savingAddress}
                          value={formProvinceId}
                          onChange={(e) => {
                            setFormProvinceId(e.target.value);
                            setFormCityId('');
                            setCities([]);
                          }}
                          className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          dir={locale === 'fa' ? 'rtl' : 'ltr'}
                        >
                          <option value="">
                            {t('settings.addresses.form.provincePlaceholder', locale)}
                          </option>
                          {provinces.map((p) => (
                            <option key={p.id} value={p.id}>
                              {locale === 'fa' ? p.nameFa : p.nameEn}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* City */}
                      <div>
                        <label
                          htmlFor="order-address-city"
                          className="block text-sm font-medium mb-1"
                        >
                          {t('settings.addresses.form.city', locale)}
                        </label>
                        <select
                          id="order-address-city"
                          value={formCityId}
                          onChange={(e) => setFormCityId(e.target.value)}
                          disabled={!formProvinceId || loadingCities || cityError || savingAddress}
                          className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          dir={locale === 'fa' ? 'rtl' : 'ltr'}
                        >
                          <option value="">
                            {t('settings.addresses.form.cityPlaceholder', locale)}
                          </option>
                          {cities.map((c) => (
                            <option key={c.id} value={c.id}>
                              {locale === 'fa' ? c.nameFa : c.nameEn}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Full Address */}
                      <div>
                        <label
                          htmlFor="order-address-fullAddress"
                          className="block text-sm font-medium mb-1"
                        >
                          {t('settings.addresses.form.fullAddress', locale)}
                        </label>
                        <textarea
                          id="order-address-fullAddress"
                          disabled={savingAddress}
                          value={formFullAddress}
                          onChange={(e) => setFormFullAddress(e.target.value)}
                          placeholder={t('settings.addresses.form.fullAddressPlaceholder', locale)}
                          className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px]"
                          dir={locale === 'fa' ? 'rtl' : 'ltr'}
                          maxLength={500}
                        />
                      </div>

                      {/* Postal Code */}
                      <div>
                        <label
                          htmlFor="order-address-postalCode"
                          className="block text-sm font-medium mb-1"
                        >
                          {t('settings.addresses.form.postalCode', locale)}
                        </label>
                        <input
                          type="text"
                          id="order-address-postalCode"
                          disabled={savingAddress}
                          value={formPostalCode}
                          onChange={(e) => setFormPostalCode(e.target.value)}
                          placeholder={t('settings.addresses.form.postalCodePlaceholder', locale)}
                          className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          dir={locale === 'fa' ? 'rtl' : 'ltr'}
                          maxLength={10}
                        />
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <Button
                          variant="outline"
                          disabled={savingAddress}
                          onClick={() => {
                            setShowNewAddressForm(false);
                            setFormProvinceId('');
                            setFormCityId('');
                            setFormFullAddress('');
                            setFormPostalCode('');
                          }}
                        >
                          {t('electricity.order.cancel', locale)}
                        </Button>
                        <Button
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
                            ? t('settings.addresses.form.saving', locale)
                            : t('electricity.order.saveAndUse', locale)}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 3: Review & Submit */}
        {(step === 3 || step === 5) && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">
                  {t(step === 3 ? 'electricity.order.step3' : 'electricity.order.review', locale)}
                </h2>
                {step === 5 && (
                  <Button variant="link" size="sm" onClick={() => setStep(3)}>
                    {t('electricity.order.edit', locale)}
                  </Button>
                )}
              </div>

              <div className="space-y-3 text-sm">
                {quoting ? (
                  <p role="status">{t('electricity.order.previewLoading', locale)}</p>
                ) : quoteError ? (
                  <p role="alert">{t('electricity.order.previewUnavailable', locale)}</p>
                ) : quote ? (
                  <div className="space-y-2 border-b pb-4">
                    <p className="flex flex-wrap items-center gap-2">
                      {t('electricity.order.period.selection', locale)}:{' '}
                      {periodDates(
                        {
                          key: period,
                          start: quote.periodStart,
                          end: quote.periodEnd,
                        },
                        locale
                      )}
                      {step === 5 && (
                        <Button variant="link" size="sm" onClick={() => setStep(1)}>
                          {t('electricity.order.edit', locale)}
                        </Button>
                      )}
                    </p>
                    {step === 5 && (
                      <p className="flex items-center gap-2">
                        {t('electricity.order.quantity', locale)}: {quote.totalKwh} kWh
                        <Button variant="link" size="sm" onClick={() => setStep(2)}>
                          {t('electricity.order.edit', locale)}
                        </Button>
                      </p>
                    )}
                    <p>
                      {t('electricity.order.averagePower', locale)}: {quote.averagePowerKw} kW
                    </p>
                    {quote.greenRuleApplies && (
                      <p className="font-medium text-amber-800">
                        {t('electricity.order.mandatoryGreen', locale)}
                      </p>
                    )}
                    {quote.lines.map((line) => (
                      <div key={line.systemKey} className="flex flex-wrap justify-between gap-2">
                        <span>
                          {line.systemKey === 'thermal'
                            ? t('electricity.order.thermal', locale)
                            : t('electricity.order.green', locale)}{' '}
                          · {line.quantityKwh} kWh × {numbers.money(line.unitPriceIrR)}
                        </span>
                        <span>
                          {numbers.money(line.subtotalIrR)}
                          {(line.discountIrR !== '0' || line.vatIrR !== '0') && (
                            <small className="block text-muted-foreground">
                              −{numbers.money(line.discountIrR)} · +{numbers.money(line.vatIrR)}{' '}
                              {t('electricity.order.vat', locale)}
                            </small>
                          )}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between">
                      <span>{t('electricity.order.discount', locale)}</span>
                      <span>{numbers.money(quote.discountIrR)}</span>
                    </div>
                    {step === 5 && (
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          {t('electricity.order.giftCode', locale)}: {appliedGiftCode || '—'}
                        </span>
                        <Button variant="link" size="sm" onClick={() => setStep(4)}>
                          {t('electricity.order.edit', locale)}
                        </Button>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>{t('electricity.order.vat', locale)}</span>
                      <span>{numbers.money(quote.vatIrR)}</span>
                    </div>
                    <div className="flex justify-between text-base font-semibold">
                      <span>{t('electricity.order.total', locale)}</span>
                      <span>{numbers.money(quote.totalIrR)}</span>
                    </div>
                  </div>
                ) : null}
                {step === 5 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t('electricity.order.profile', locale)}:
                      </span>
                      <span className="max-w-[60%] break-all font-medium">{activeProfileId}</span>
                    </div>
                    {/* Selected product */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        {t('electricity.order.product', locale)}:
                      </span>
                      <span className="font-medium">
                        {productTitle(products.find((p) => p.id === selectedProductId)) || '—'}
                      </span>
                      <Button variant="link" size="sm" onClick={() => setStep(1)}>
                        {t('electricity.order.edit', locale)}
                      </Button>
                    </div>

                    {/* Selected address */}
                    <div className="flex justify-between items-start">
                      <span className="text-muted-foreground">
                        {t('electricity.order.deliveryAddress', locale)}:
                      </span>
                      <span className="font-medium text-right max-w-[60%]">
                        {selectedAddress
                          ? `${getProvinceName(selectedAddress.provinceId)}، ${getCityName(selectedAddress.cityId)} — ${selectedAddress.fullAddress}`
                          : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t('electricity.order.walletBalance', locale)}:
                      </span>
                      <span>
                        {walletBalance === null
                          ? t('electricity.order.walletUnavailable', locale)
                          : numbers.money(walletBalance)}
                      </span>
                    </div>
                    {quote && (
                      <WalletFundingPrompt balance={walletBalance} total={quote.totalIrR} />
                    )}
                    <div className="space-y-2 border-t pt-4 text-muted-foreground">
                      <h3 className="font-medium text-foreground">
                        {t('electricity.order.contractPreview', locale)}
                      </h3>
                      {quote && (
                        <div className="rounded-lg border bg-muted/30 p-3 text-foreground">
                          <p>
                            {t('electricity.order.quantity', locale)}: {quote.totalKwh} kWh
                          </p>
                          <p>
                            {t('electricity.order.period.selection', locale)}:{' '}
                            {periodDates(
                              {
                                key: period,
                                start: quote.periodStart,
                                end: quote.periodEnd,
                              },
                              locale
                            )}
                          </p>
                          <p>
                            {t('electricity.order.total', locale)}: {numbers.money(quote.totalIrR)}
                          </p>
                        </div>
                      )}
                      <p>{t('electricity.order.contractPreviewText', locale)}</p>
                      <h3 className="font-medium text-foreground">
                        {t('electricity.order.cancellationRules', locale)}
                      </h3>
                      <p>{t('electricity.order.cancellationRulesText', locale)}</p>
                      <p>{t('electricity.order.paymentAfterSubmit', locale)}</p>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </FormWizard>
    </div>
  );
}
