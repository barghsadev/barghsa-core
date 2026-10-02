import { Link, useNavigate } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, CardContent, FinancialReviewSummary } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useWizardStep } from '../hooks/useWizardStep.js';
import { useWizardDraftProtection } from '../hooks/useWizardDraftProtection.js';
import { uuidReference } from '../lib/form-receipt.js';
import { tSaving } from '@barghsa/i18n/saving';
import { withCsrf } from '../lib/csrf.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useFormDraft, type DraftSchema } from '../hooks/useFormDraft.js';
import { WalletFundingPrompt } from '../components/WalletFundingPrompt.js';

interface Product {
  id: string;
  title: { fa: string; en: string };
  description: { fa: string; en: string } | null;
  price: string | null;
  status: string;
  stock_tracking?: boolean;
  available_count?: number;
}
interface Plan extends Product {
  hardware: Product[];
  agreement: { versionId: string; title: string; body: string } | null;
  available: boolean;
}
interface Address {
  id: string;
  fullAddress: string;
  postalCode: string;
  mainAddress: boolean;
}
interface Geography {
  id: string;
  nameFa: string;
  nameEn: string;
}
interface Quote {
  reviewDigest: string;
  subtotalIrR: string;
  discountIrR: string;
  vatIrR: string;
  totalIrR: string;
  lines: Array<{
    type: string;
    title: { fa: string; en: string };
    amountIrR: string;
    discountIrR: string;
    vatIrR: string;
  }>;
}
interface Draft {
  planId: string;
  hardwareId: string;
  billIdentifier: string;
  addressId: string;
  giftCode: string;
}

const draftSchema: DraftSchema<Draft> = {
  safeParse(value) {
    if (!value || typeof value !== 'object') return { success: false };
    const data = value as Record<string, unknown>;
    if (
      ['planId', 'hardwareId', 'billIdentifier', 'addressId', 'giftCode'].some(
        (key) => typeof data[key] !== 'string'
      )
    )
      return { success: false };
    return { success: true, data: data as unknown as Draft };
  },
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

const LeaveDialog = lazy(() => import('../components/WizardLeaveDialog.js'));

export function SavingsOrderPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const navigate = useNavigate();
  const copy = (key: string) => tSaving(key, locale);
  const title = (product: Product) => product.title[locale] || product.title.en || product.title.fa;
  const [profileId, setProfileId] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const wizard = useWizardStep('/savings/order', 6);
  const { step } = wizard;
  const [planId, setPlanId] = useState('');
  const [hardwareId, setHardwareId] = useState('');
  const [hardwareConfirmed, setHardwareConfirmed] = useState(false);
  const [billIdentifier, setBillIdentifier] = useState('');
  const [verification, setVerification] = useState<'idle' | 'checking' | 'verified' | 'manual'>(
    'idle'
  );
  const [duplicate, setDuplicate] = useState<{
    duplicate: boolean;
    preventActiveDuplicates: boolean;
    existingOrderId: string | null;
  } | null>(null);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [duplicateChecking, setDuplicateChecking] = useState(false);
  const [duplicateError, setDuplicateError] = useState(false);
  const [duplicateRevision, setDuplicateRevision] = useState(0);
  const [addressId, setAddressId] = useState('');
  const [addingAddress, setAddingAddress] = useState(false);
  const [provinces, setProvinces] = useState<Geography[]>([]);
  const [cities, setCities] = useState<Geography[]>([]);
  const [provinceId, setProvinceId] = useState('');
  const [cityId, setCityId] = useState('');
  const [fullAddress, setFullAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [giftCode, setGiftCode] = useState('');
  const [appliedGiftCode, setAppliedGiftCode] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [submitForReview, setSubmitForReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const submissionKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const hydratedProfile = useRef<string | null>(null);
  const [addressError, setAddressError] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const draftKey = profileId
    ? `/api/saving/orders/draft?profileId=${encodeURIComponent(profileId)}`
    : null;
  const {
    draft,
    loading: draftLoading,
    error: draftError,
    save: saveDraft,
    retry: retryDraft,
  } = useFormDraft(draftKey, draftSchema);
  const currentDraft = useMemo(
    () => ({ planId, hardwareId, billIdentifier, addressId, giftCode }),
    [planId, hardwareId, billIdentifier, addressId, giftCode]
  );
  const addressDirty = addingAddress && !!(provinceId || cityId || fullAddress || postalCode);
  const protection = useWizardDraftProtection({
    profileId,
    data: currentDraft,
    step,
    ready: !!draft && !loading && !draftLoading && !draftError,
    saveDraft,
    go: wizard.go,
    extraDirty: addressDirty,
    saveDisabled: addressDirty,
  });
  const savingDraft = protection.busy;
  const draftSaveError = protection.saveError;
  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === planId), [plans, planId]);
  const selectedHardware = selectedPlan?.hardware.find((item) => item.id === hardwareId);
  const steps = [
    'stepPlan',
    'stepHardware',
    'stepBill',
    'stepAddress',
    'stepAgreement',
    'stepReview',
  ];

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [profileResponse, plansResponse] = await Promise.all([
          fetch('/api/profiles', { credentials: 'include', signal: controller.signal }),
          fetch('/api/saving/plans', { credentials: 'include', signal: controller.signal }),
        ]);
        if (!profileResponse.ok || !plansResponse.ok) throw new Error('load');
        const profile = (await profileResponse.json()) as {
          activeProfileId: string | null;
          profiles: Array<{ id: string; profileType?: string; type?: string }>;
        };
        const catalogue = (await plansResponse.json()) as { plans: Plan[] };
        if (controller.signal.aborted) return;
        const active = profile.profiles.find((item) => item.id === profile.activeProfileId);
        setProfileId(
          active && (active.profileType ?? active.type) === 'INDIVIDUAL' ? active.id : null
        );
        setPlans(catalogue.plans);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!profileId) return;
    const controller = new AbortController();
    void fetch(`/api/profiles/${profileId}/addresses`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('addresses');
        return response.json() as Promise<{ addresses: Address[] }>;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setAddresses(result.addresses);
          setAddressId(
            (current) => current || result.addresses.find((item) => item.mainAddress)?.id || ''
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, [profileId]);

  useEffect(() => {
    if (!profileId || !draft || loading || hydratedProfile.current === profileId) return;
    hydratedProfile.current = profileId;
    if (draft.data) {
      setPlanId(draft.data.planId);
      setHardwareId(draft.data.hardwareId);
      setBillIdentifier(draft.data.billIdentifier);
      setAddressId(draft.data.addressId);
      setGiftCode(draft.data.giftCode);
    }
    // Equipment confirmation and agreement acceptance are never persisted as consent.
    const restored = draft.data ? Math.min(2, draft.currentStep) : 1;
    wizard.restore(restored);
    protection.markSaved(draft.data ?? currentDraft, restored);
  }, [profileId, draft, loading, currentDraft, wizard.restore, protection.markSaved]);
  useEffect(() => {
    if (step > 2 && !hardwareConfirmed) wizard.restore(2);
    else if (step > 5 && !agreementAccepted) wizard.restore(5);
  }, [step, hardwareConfirmed, agreementAccepted, wizard.restore]);
  async function saveNow() {
    const saved = await protection.save();
    if (saved) setDraftSaved(true);
    return saved;
  }
  async function advanceStep() {
    if (!canNext) return;
    await protection.save(step + 1);
  }

  useEffect(() => {
    if (!addingAddress) return;
    const controller = new AbortController();
    void fetch('/api/geography/provinces', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Geography unavailable');
        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) throw new Error('Invalid geography');
        return rows as Geography[];
      })
      .then((rows) => {
        if (!controller.signal.aborted) setProvinces(rows);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAddressError(true);
      });
    return () => controller.abort();
  }, [addingAddress]);
  useEffect(() => {
    setCities([]);
    setCityId('');
    if (!provinceId) return;
    const controller = new AbortController();
    void fetch(`/api/geography/provinces/${provinceId}/cities`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Geography unavailable');
        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) throw new Error('Invalid geography');
        return rows as Geography[];
      })
      .then((rows) => {
        if (!controller.signal.aborted) setCities(rows);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAddressError(true);
      });
    return () => controller.abort();
  }, [provinceId]);

  async function saveAddress() {
    if (
      !profileId ||
      !provinceId ||
      !cityId ||
      !fullAddress.trim() ||
      !/^[0-9]{10}$/.test(postalCode)
    )
      return;
    await protection.run(async (current, alive) => {
      setSavingAddress(true);
      setAddressError(false);
      try {
        const address = await postJson<Address>(`/api/profiles/${profileId}/addresses`, {
          provinceId,
          cityId,
          fullAddress: fullAddress.trim(),
          postalCode,
        });
        uuidReference(address?.id);
        if (address.fullAddress !== fullAddress.trim() || address.postalCode !== postalCode)
          throw new Error('Invalid address receipt');
        if (!current()) return;
        setAddresses((values) => [...values, address]);
        setAddressId(address.id);
        setAddingAddress(false);
        setProvinceId('');
        setCityId('');
        setFullAddress('');
        setPostalCode('');
      } catch {
        if (current()) setAddressError(true);
      } finally {
        if (alive()) setSavingAddress(false);
      }
    });
  }
  async function verifyBill() {
    if (!profileId || !/^[0-9]{6,13}$/.test(billIdentifier)) return;
    await protection.run(async (current, alive) => {
      setVerification('checking');
      let status: 'verified' | 'manual' = 'manual';
      try {
        const result = await postJson<{ status: string }>('/api/saving/orders/verify-bill', {
          profileId,
          billIdentifier,
        });
        status = result.status === 'verified' ? 'verified' : 'manual';
      } catch {
        /* A bill can still be submitted for manual staff verification. */
      } finally {
        if (alive()) setVerification(current() ? status : 'idle');
      }
    });
  }

  useEffect(() => {
    if (step !== 6 || !profileId || !selectedPlan?.agreement || !selectedHardware || !addressId)
      return;
    const controller = new AbortController();
    setQuote(null);
    setQuoteError(false);
    setQuoting(true);
    void fetch('/api/saving/orders/quote', {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers: withCsrf({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        profileId,
        savingPlanId: planId,
        hardwareProductId: hardwareId,
        billIdentifier,
        installationAddressId: addressId,
        agreementVersionId: selectedPlan.agreement.versionId,
        ...(appliedGiftCode ? { giftCode: appliedGiftCode } : {}),
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('quote');
        return response.json() as Promise<Quote>;
      })
      .then((result) => {
        if (!controller.signal.aborted) setQuote(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setQuoteError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuoting(false);
      });
    return () => controller.abort();
  }, [
    step,
    profileId,
    selectedPlan,
    selectedHardware,
    addressId,
    planId,
    hardwareId,
    billIdentifier,
    appliedGiftCode,
    quoteRevision,
  ]);

  useEffect(() => {
    if (step !== 3) {
      setDuplicateChecking(false);
      return;
    }
    setDuplicate(null);
    setDuplicateAcknowledged(false);
    setDuplicateError(false);
    if (!profileId || !planId || !/^[0-9]{6,13}$/.test(billIdentifier)) {
      setDuplicateChecking(false);
      return;
    }
    const controller = new AbortController();
    setDuplicateChecking(true);
    const timer = setTimeout(() => {
      void fetch('/api/saving/orders/duplicate', {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ profileId, savingPlanId: planId, billIdentifier }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('duplicate');
          return response.json() as Promise<{
            duplicate: boolean;
            preventActiveDuplicates: boolean;
            existingOrderId: string | null;
          }>;
        })
        .then((result) => {
          if (!controller.signal.aborted) setDuplicate(result);
        })
        .catch(() => {
          if (!controller.signal.aborted) setDuplicateError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setDuplicateChecking(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [step, profileId, planId, billIdentifier, duplicateRevision]);

  useEffect(() => {
    if (step !== 6 || !profileId) return;
    const controller = new AbortController();
    void fetch(`/api/wallet/${profileId}`, { credentials: 'include', signal: controller.signal })
      .then(
        (response) => response.json() as Promise<{ balance?: string; availableBalance?: string }>
      )
      .then((result) => {
        if (!controller.signal.aborted)
          setWalletBalance(result.availableBalance ?? result.balance ?? null);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [step, profileId]);

  const canNext =
    step === 1
      ? !!selectedPlan?.available
      : step === 2
        ? !!selectedHardware &&
          selectedHardware.status === 'active' &&
          (!selectedHardware.stock_tracking || (selectedHardware.available_count ?? 0) > 0) &&
          hardwareConfirmed
        : step === 3
          ? /^[0-9]{6,13}$/.test(billIdentifier) &&
            !duplicateChecking &&
            !duplicateError &&
            (duplicate?.duplicate === false ||
              (duplicate?.preventActiveDuplicates === false && duplicateAcknowledged))
          : step === 4
            ? !addressDirty && addresses.some((address) => address.id === addressId)
            : step === 5
              ? agreementAccepted
              : false;
  async function submit() {
    if (
      !profileId ||
      !selectedPlan?.available ||
      !selectedPlan.agreement ||
      !selectedHardware ||
      !hardwareConfirmed ||
      !agreementAccepted ||
      !quote ||
      quoting ||
      quoteError ||
      !submitForReview ||
      addressDirty ||
      !addresses.some((address) => address.id === addressId)
    )
      return;
    await protection.run(async (current, alive) => {
      setSubmitting(true);
      setSubmitError('');
      const input = {
        profileId,
        savingPlanId: planId,
        hardwareProductId: hardwareId,
        billIdentifier,
        installationAddressId: addressId,
        agreementVersionId: selectedPlan.agreement!.versionId,
        ...(appliedGiftCode ? { giftCode: appliedGiftCode } : {}),
        expectedQuoteDigest: quote.reviewDigest,
        ...(duplicateAcknowledged ? { duplicateAcknowledged: true } : {}),
        agreementAccepted: true,
        hardwareConfirmed: true,
        submitForStaffReview: true,
      };
      const fingerprint = JSON.stringify(input);
      if (submissionKey.current?.fingerprint !== fingerprint)
        submissionKey.current = { fingerprint, key: crypto.randomUUID() };
      try {
        const result = await postJson<{ savingOrderId?: unknown }>('/api/saving/orders', {
          ...input,
          idempotencyKey: submissionKey.current.key,
        });
        const orderId = uuidReference(result?.savingOrderId);
        if (!current()) return;
        protection.completed.current = true;
        protection.blocker.reset?.();
        await navigate({ to: '/savings/orders/$orderId', params: { orderId } });
      } catch (error) {
        if (!current()) return;
        protection.completed.current = false;
        if (error instanceof Error && error.message.includes('(409)')) {
          submissionKey.current = null;
          setQuoteRevision((value) => value + 1);
        }
        setSubmitError(copy('orderError'));
      } finally {
        if (alive()) setSubmitting(false);
      }
    });
  }

  return (
    <main
      className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {protection.blocker.status === 'blocked' && (
        <Suspense fallback={<p role="status">{copy('loading')}</p>}>
          <LeaveDialog
            onSave={saveNow}
            working={protection.busy}
            workingLabel={copy('loading')}
            saveDisabled={addressDirty}
            errorMessage={
              addressDirty
                ? t('electricity.order.unsaved.address', locale)
                : draftSaveError
                  ? copy('draftSaveError')
                  : undefined
            }
            onStay={() => protection.blocker.reset?.()}
            onLeave={() => protection.blocker.proceed?.()}
          />
        </Suspense>
      )}
      <header className="space-y-2">
        <Link to="/savings" className="text-sm text-primary hover:underline">
          {copy('title')}
        </Link>
        <h1 className="text-3xl font-semibold">{copy('orderTitle')}</h1>
      </header>
      {loading && <p role="status">{copy('loading')}</p>}
      {loadError && (
        <p role="alert" className="text-destructive">
          {copy('error')}
        </p>
      )}
      {draftError && profileId && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>{copy('draftLoadError')}</p>
          <Button variant="outline" onClick={retryDraft}>
            {copy('retry')}
          </Button>
        </div>
      )}
      {draftLoading && profileId && <p role="status">{copy('loading')}</p>}
      {!loading && !profileId && <p role="alert">{copy('profileRequired')}</p>}
      {addressDirty && step !== 4 && (
        <div role="alert" className="space-y-2">
          <p>{t('electricity.order.unsaved.address', locale)}</p>
          <Button
            variant="outline"
            onClick={() => {
              void wizard.go(4, step);
            }}
          >
            {copy('stepAddress')}
          </Button>
        </div>
      )}
      {!loading && profileId && draft && !draftLoading && !draftError && (
        <>
          <nav aria-label={copy('orderTitle')}>
            <ol className="grid grid-cols-3 gap-2 text-xs md:grid-cols-6">
              {steps.map((key, index) => (
                <li
                  key={key}
                  aria-current={step === index + 1 ? 'step' : undefined}
                  className={`rounded-md px-2 py-3 text-center ${step === index + 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                >
                  {numbers.number(index + 1)}. {copy(key)}
                </li>
              ))}
            </ol>
          </nav>
          <Card>
            <CardContent className="space-y-5 pt-6">
              <fieldset
                className="min-w-0 space-y-5"
                disabled={protection.busy || protection.completed.current}
              >
                {step === 1 && (
                  <section className="space-y-3">
                    <h2 className="text-xl font-semibold">{copy('choosePlan')}</h2>
                    {plans.map((plan) => (
                      <label
                        key={plan.id}
                        className={`flex gap-3 rounded-md border p-4 ${!plan.available ? 'opacity-60' : 'cursor-pointer'}`}
                      >
                        <input
                          type="radio"
                          name="plan"
                          value={plan.id}
                          checked={planId === plan.id}
                          disabled={!plan.available}
                          onChange={() => {
                            setPlanId(plan.id);
                            setHardwareId('');
                            setHardwareConfirmed(false);
                            setAgreementAccepted(false);
                          }}
                        />
                        <span className="space-y-1">
                          <span className="block font-medium">{title(plan)}</span>
                          <span className="block text-sm text-muted-foreground">
                            {plan.description?.[locale]}
                          </span>
                          <bdi className="block text-sm">
                            {plan.price ? numbers.money(plan.price) : copy('unpriced')}
                          </bdi>
                        </span>
                      </label>
                    ))}
                  </section>
                )}
                {step === 2 && (
                  <section className="space-y-3">
                    <h2 className="text-xl font-semibold">{copy('chooseHardware')}</h2>
                    {selectedPlan?.hardware.map((item) => (
                      <label key={item.id} className="flex gap-3 rounded-md border p-4">
                        <input
                          type="radio"
                          name="hardware"
                          value={item.id}
                          checked={hardwareId === item.id}
                          disabled={
                            item.status !== 'active' ||
                            (!!item.stock_tracking && (item.available_count ?? 0) < 1)
                          }
                          onChange={() => {
                            setHardwareId(item.id);
                            setHardwareConfirmed(false);
                          }}
                        />
                        <span>
                          <span className="block font-medium">{title(item)}</span>
                          <span className="block text-sm">{item.description?.[locale]}</span>
                          <bdi>{item.price ? numbers.money(item.price) : copy('unpriced')}</bdi>
                          <span className="block text-sm text-muted-foreground">
                            {item.stock_tracking
                              ? (item.available_count ?? 0) > 0
                                ? copy('inStock')
                                : copy('outOfStock')
                              : copy('subjectToConfirmation')}
                          </span>
                        </span>
                      </label>
                    ))}
                    <label className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={hardwareConfirmed}
                        onChange={(event) => setHardwareConfirmed(event.target.checked)}
                      />
                      {copy('confirmHardware')}
                    </label>
                  </section>
                )}
                {step === 3 && (
                  <section className="space-y-3">
                    <h2 className="text-xl font-semibold">{copy('billIdentifier')}</h2>
                    <input
                      aria-label={copy('billIdentifier')}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={13}
                      value={billIdentifier}
                      onChange={(event) => {
                        setBillIdentifier(
                          normalizeProfileDigits(event.target.value).replace(/[^0-9]/g, '')
                        );
                        setVerification('idle');
                      }}
                      className="w-full rounded-md border bg-background p-3"
                      dir="ltr"
                    />
                    {billIdentifier && !/^[0-9]{6,13}$/.test(billIdentifier) && (
                      <p className="text-sm text-destructive">{copy('invalidBill')}</p>
                    )}
                    {duplicateError && (
                      <div role="alert" className="space-y-2 text-sm text-destructive">
                        <p>{copy('duplicateCheckError')}</p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setDuplicateRevision((value) => value + 1)}
                        >
                          {copy('retry')}
                        </Button>
                      </div>
                    )}
                    <Button
                      variant="outline"
                      disabled={
                        !/^[0-9]{6,13}$/.test(billIdentifier) || verification === 'checking'
                      }
                      onClick={() => void verifyBill()}
                    >
                      {copy('verifyBill')}
                    </Button>
                    {verification === 'verified' && <p role="status">{copy('verified')}</p>}
                    {verification === 'manual' && <p role="status">{copy('manualReview')}</p>}
                    {duplicate?.duplicate && (
                      <div
                        role="alert"
                        className="rounded-md border border-destructive/30 p-3 text-sm"
                      >
                        <p>
                          {copy(
                            !duplicate.preventActiveDuplicates
                              ? 'duplicateAllowedNotice'
                              : duplicate.existingOrderId
                                ? 'duplicateOrder'
                                : 'duplicateSupport'
                          )}
                        </p>
                        {duplicate.existingOrderId && (
                          <Link
                            to="/savings/orders/$orderId"
                            params={{ orderId: duplicate.existingOrderId }}
                            className="text-primary hover:underline"
                          >
                            {copy('openExisting')}
                          </Link>
                        )}
                        {!duplicate.preventActiveDuplicates && (
                          <label className="mt-3 flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={duplicateAcknowledged}
                              onChange={(event) => setDuplicateAcknowledged(event.target.checked)}
                            />
                            {copy('acknowledgeDuplicate')}
                          </label>
                        )}
                      </div>
                    )}
                  </section>
                )}
                {step === 4 && (
                  <section className="space-y-3">
                    <h2 className="text-xl font-semibold">{copy('chooseAddress')}</h2>
                    {addresses.map((address) => (
                      <label key={address.id} className="flex gap-3 rounded-md border p-3">
                        <input
                          type="radio"
                          name="address"
                          value={address.id}
                          checked={addressId === address.id}
                          onChange={() => setAddressId(address.id)}
                        />
                        <span>
                          {address.fullAddress} · <bdi>{address.postalCode}</bdi>
                        </span>
                      </label>
                    ))}
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (addingAddress) {
                          setProvinceId('');
                          setCityId('');
                          setFullAddress('');
                          setPostalCode('');
                          setAddressError(false);
                        }
                        setAddingAddress((value) => !value);
                      }}
                    >
                      {addingAddress ? t('electricity.order.cancel', locale) : copy('newAddress')}
                    </Button>
                    {addressError && <p role="alert">{copy('error')}</p>}
                    {addingAddress && (
                      <div className="grid gap-3 rounded-md border p-4 md:grid-cols-2">
                        <label>
                          {copy('province')}
                          <select
                            className="mt-1 w-full rounded-md border bg-background p-2"
                            value={provinceId}
                            onChange={(event) => setProvinceId(event.target.value)}
                          >
                            <option value="">—</option>
                            {provinces.map((item) => (
                              <option key={item.id} value={item.id}>
                                {locale === 'fa' ? item.nameFa : item.nameEn}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {copy('city')}
                          <select
                            className="mt-1 w-full rounded-md border bg-background p-2"
                            value={cityId}
                            onChange={(event) => setCityId(event.target.value)}
                          >
                            <option value="">—</option>
                            {cities.map((item) => (
                              <option key={item.id} value={item.id}>
                                {locale === 'fa' ? item.nameFa : item.nameEn}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {copy('fullAddress')}
                          <input
                            className="mt-1 w-full rounded-md border bg-background p-2"
                            maxLength={500}
                            value={fullAddress}
                            onChange={(event) => setFullAddress(event.target.value)}
                          />
                        </label>
                        <label>
                          {copy('postalCode')}
                          <input
                            className="mt-1 w-full rounded-md border bg-background p-2"
                            inputMode="numeric"
                            maxLength={10}
                            value={postalCode}
                            onChange={(event) =>
                              setPostalCode(
                                normalizeProfileDigits(event.target.value).replace(/[^0-9]/g, '')
                              )
                            }
                          />
                        </label>
                        <Button
                          disabled={
                            savingAddress ||
                            !provinceId ||
                            !cityId ||
                            !fullAddress.trim() ||
                            !/^[0-9]{10}$/.test(postalCode)
                          }
                          onClick={() => void saveAddress()}
                        >
                          {copy('saveAddress')}
                        </Button>
                      </div>
                    )}
                  </section>
                )}
                {step === 5 && (
                  <section className="space-y-4">
                    <h2 className="text-xl font-semibold">{selectedPlan?.agreement?.title}</h2>
                    <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm">
                      {selectedPlan?.agreement?.body}
                    </div>
                    <label className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={agreementAccepted}
                        onChange={(event) => setAgreementAccepted(event.target.checked)}
                      />
                      {copy('acceptAgreement')}
                    </label>
                  </section>
                )}
                {step === 6 && (
                  <section className="space-y-4">
                    <h2 className="text-xl font-semibold">{copy('stepReview')}</h2>
                    <dl className="grid gap-2 text-sm md:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">{copy('stepPlan')}</dt>
                        <dd>{selectedPlan && title(selectedPlan)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{copy('stepHardware')}</dt>
                        <dd>{selectedHardware && title(selectedHardware)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{copy('billIdentifier')}</dt>
                        <dd dir="ltr">{billIdentifier}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{copy('stepAddress')}</dt>
                        <dd>{addresses.find((item) => item.id === addressId)?.fullAddress}</dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      {[1, 2, 3, 4, 5].map((target) => (
                        <Button
                          key={target}
                          variant="outline"
                          onClick={() => {
                            void protection.save(target);
                          }}
                        >
                          {t('electricity.order.edit', locale)} · {copy(steps[target - 1]!)}
                        </Button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex-1">
                        {copy('giftCode')}
                        <input
                          className="mt-1 w-full rounded-md border bg-background p-2"
                          value={giftCode}
                          onChange={(event) => setGiftCode(event.target.value)}
                        />
                      </label>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setAppliedGiftCode(giftCode.trim());
                          setQuoteRevision((value) => value + 1);
                          submissionKey.current = null;
                        }}
                      >
                        {copy('apply')}
                      </Button>
                    </div>
                    {quoting && <p role="status">{copy('loading')}</p>}
                    {quoteError && (
                      <div role="alert">
                        <p>{copy('quoteError')}</p>
                        <Button
                          variant="outline"
                          onClick={() => setQuoteRevision((value) => value + 1)}
                        >
                          {copy('retry')}
                        </Button>
                      </div>
                    )}
                    {quote && (
                      <FinancialReviewSummary
                        title={copy('stepReview')}
                        rows={[
                          ...quote.lines.map((line) => ({
                            id: line.type,
                            label: line.title[locale],
                            value: (
                              <>
                                {numbers.money(line.amountIrR)}
                                {(line.discountIrR !== '0' || line.vatIrR !== '0') && (
                                  <small className="block text-muted-foreground">
                                    −{numbers.money(line.discountIrR)} · +
                                    {numbers.money(line.vatIrR)} {copy('vat')}
                                  </small>
                                )}
                              </>
                            ),
                          })),
                          {
                            id: 'subtotal',
                            label: copy('subtotal'),
                            value: numbers.money(quote.subtotalIrR),
                          },
                          {
                            id: 'discount',
                            label: copy('discount'),
                            value: numbers.money(quote.discountIrR),
                          },
                          { id: 'vat', label: copy('vat'), value: numbers.money(quote.vatIrR) },
                        ]}
                        total={{ label: copy('total'), value: numbers.money(quote.totalIrR) }}
                      />
                    )}
                    <p className="text-sm">
                      {copy('walletBalance')}:{' '}
                      {walletBalance === null ? '—' : numbers.money(walletBalance)}
                    </p>
                    {quote && (
                      <WalletFundingPrompt balance={walletBalance} total={quote.totalIrR} />
                    )}
                    <label className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={submitForReview}
                        onChange={(event) => setSubmitForReview(event.target.checked)}
                      />
                      {copy('submitForReview')}
                    </label>
                    {submitError && (
                      <p role="alert" className="text-destructive">
                        {submitError}
                      </p>
                    )}
                  </section>
                )}
              </fieldset>
              {draftSaved && !protection.dirty && !draftSaveError && (
                <p role="status">{t('electricity.order.draftSaved', locale)}</p>
              )}
              <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
                {draftSaveError && (
                  <p role="alert" className="text-destructive">
                    {copy('draftSaveError')}
                  </p>
                )}
                <Button
                  variant="outline"
                  disabled={
                    step === 1 || protection.busy || protection.completed.current || addressDirty
                  }
                  onClick={() => {
                    void protection.save(step - 1);
                  }}
                >
                  {copy('back')}
                </Button>
                <Button
                  variant="outline"
                  disabled={protection.busy || protection.completed.current || addressDirty}
                  onClick={() => {
                    void saveNow();
                  }}
                >
                  {t(
                    savingDraft ? 'electricity.order.savingDraft' : 'electricity.order.saveDraft',
                    locale
                  )}
                </Button>
                {step < 6 ? (
                  <Button
                    disabled={!canNext || protection.busy || protection.completed.current}
                    onClick={() => void advanceStep()}
                  >
                    {copy('next')}
                  </Button>
                ) : (
                  <Button
                    disabled={
                      !quote ||
                      quoting ||
                      quoteError ||
                      !hardwareConfirmed ||
                      !agreementAccepted ||
                      !submitForReview ||
                      addressDirty ||
                      protection.busy ||
                      protection.completed.current
                    }
                    onClick={() => void submit()}
                  >
                    {copy(submitting ? 'submitting' : 'submit')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
