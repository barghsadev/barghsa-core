import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, CardContent } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { withCsrf } from '../lib/csrf.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

interface Product {
  id: string;
  title: { fa: string; en: string };
  description: { fa: string; en: string } | null;
  price: string | null;
  status: string;
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
  step: number;
}

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
  const [step, setStep] = useState(1);
  const [planId, setPlanId] = useState('');
  const [hardwareId, setHardwareId] = useState('');
  const [hardwareConfirmed, setHardwareConfirmed] = useState(false);
  const [billIdentifier, setBillIdentifier] = useState('');
  const [verification, setVerification] = useState<'idle' | 'checking' | 'verified' | 'manual'>(
    'idle'
  );
  const [duplicate, setDuplicate] = useState<{
    duplicate: boolean;
    existingOrderId: string | null;
  } | null>(null);
  const [duplicateChecking, setDuplicateChecking] = useState(false);
  const [duplicateError, setDuplicateError] = useState(false);
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
  const submissionKey = useRef<string | null>(null);
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
        if (active && (active.profileType ?? active.type) === 'INDIVIDUAL') {
          const saved = sessionStorage.getItem(`saving-order:${active.id}`);
          if (saved) {
            try {
              const draft = JSON.parse(saved) as Draft;
              setPlanId(draft.planId);
              setHardwareId(draft.hardwareId);
              setBillIdentifier(draft.billIdentifier);
              setAddressId(draft.addressId);
              setGiftCode(draft.giftCode);
              setStep(Math.min(5, Math.max(1, draft.step)));
            } catch {
              sessionStorage.removeItem(`saving-order:${active.id}`);
            }
          }
        }
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
    if (!profileId || loading) return;
    sessionStorage.setItem(
      `saving-order:${profileId}`,
      JSON.stringify({
        planId,
        hardwareId,
        billIdentifier,
        addressId,
        giftCode,
        step,
      } satisfies Draft)
    );
  }, [profileId, loading, planId, hardwareId, billIdentifier, addressId, giftCode, step]);

  useEffect(() => {
    if (!addingAddress) return;
    const controller = new AbortController();
    void fetch('/api/geography/provinces', { signal: controller.signal })
      .then((response) => response.json() as Promise<Geography[]>)
      .then((rows) => {
        if (!controller.signal.aborted) setProvinces(rows);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [addingAddress]);
  useEffect(() => {
    setCities([]);
    setCityId('');
    if (!provinceId) return;
    const controller = new AbortController();
    void fetch(`/api/geography/provinces/${provinceId}/cities`, { signal: controller.signal })
      .then((response) => response.json() as Promise<Geography[]>)
      .then((rows) => {
        if (!controller.signal.aborted) setCities(rows);
      })
      .catch(() => {});
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
    setSavingAddress(true);
    try {
      const address = await postJson<Address>(`/api/profiles/${profileId}/addresses`, {
        provinceId,
        cityId,
        fullAddress: fullAddress.trim(),
        postalCode,
      });
      setAddresses((current) => [...current, address]);
      setAddressId(address.id);
      setAddingAddress(false);
    } catch {
      setLoadError(true);
    } finally {
      setSavingAddress(false);
    }
  }

  async function verifyBill() {
    if (!profileId || !/^[0-9]{6,13}$/.test(billIdentifier)) return;
    setVerification('checking');
    try {
      const result = await postJson<{ status: string }>('/api/saving/orders/verify-bill', {
        profileId,
        billIdentifier,
      });
      setVerification(result.status === 'verified' ? 'verified' : 'manual');
    } catch {
      setVerification('manual');
    }
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
    setDuplicate(null);
    setDuplicateError(false);
    if (step !== 3 || !profileId || !planId || !/^[0-9]{6,13}$/.test(billIdentifier)) {
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
          return response.json() as Promise<{ duplicate: boolean; existingOrderId: string | null }>;
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
  }, [step, profileId, planId, billIdentifier]);

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
        ? !!selectedHardware && selectedHardware.status === 'active' && hardwareConfirmed
        : step === 3
          ? /^[0-9]{6,13}$/.test(billIdentifier) &&
            !duplicateChecking &&
            (duplicateError || duplicate?.duplicate === false)
          : step === 4
            ? !!addressId
            : step === 5
              ? agreementAccepted
              : false;
  async function submit() {
    if (!profileId || !selectedPlan?.agreement || !quote || !submitForReview || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    submissionKey.current ??= crypto.randomUUID();
    try {
      const result = await postJson<{ savingOrderId: string }>('/api/saving/orders', {
        profileId,
        savingPlanId: planId,
        hardwareProductId: hardwareId,
        billIdentifier,
        installationAddressId: addressId,
        agreementVersionId: selectedPlan.agreement.versionId,
        ...(appliedGiftCode ? { giftCode: appliedGiftCode } : {}),
        idempotencyKey: submissionKey.current,
        expectedQuoteDigest: quote.reviewDigest,
        agreementAccepted: true,
        hardwareConfirmed: true,
        submitForStaffReview: true,
      });
      sessionStorage.removeItem(`saving-order:${profileId}`);
      void navigate({ to: '/savings/orders/$orderId', params: { orderId: result.savingOrderId } });
    } catch (error) {
      if (error instanceof Error && error.message.includes('(409)')) {
        submissionKey.current = null;
        setQuoteRevision((value) => value + 1);
      }
      setSubmitError(copy('orderError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
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
      {!loading && !profileId && <p role="alert">{copy('profileRequired')}</p>}
      {!loading && profileId && (
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
                        disabled={item.status !== 'active'}
                        onChange={() => {
                          setHardwareId(item.id);
                          setHardwareConfirmed(false);
                        }}
                      />
                      <span>
                        <span className="block font-medium">{title(item)}</span>
                        <span className="block text-sm">{item.description?.[locale]}</span>
                        <bdi>{item.price ? numbers.money(item.price) : copy('unpriced')}</bdi>
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
                  <Button
                    variant="outline"
                    disabled={!/^[0-9]{6,13}$/.test(billIdentifier) || verification === 'checking'}
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
                        {copy(duplicate.existingOrderId ? 'duplicateOrder' : 'duplicateSupport')}
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
                  <Button variant="outline" onClick={() => setAddingAddress((value) => !value)}>
                    {copy('newAddress')}
                  </Button>
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
                    <div className="rounded-md border">
                      <dl className="divide-y">
                        {quote.lines.map((line) => (
                          <div key={line.type} className="flex justify-between gap-3 p-3">
                            <dt>{line.title[locale]}</dt>
                            <dd>
                              <bdi>{numbers.money(line.amountIrR)}</bdi>
                            </dd>
                          </div>
                        ))}
                        {(
                          [
                            ['subtotal', quote.subtotalIrR],
                            ['discount', quote.discountIrR],
                            ['vat', quote.vatIrR],
                            ['total', quote.totalIrR],
                          ] as const
                        ).map(([key, value]) => (
                          <div
                            key={key}
                            className={`flex justify-between gap-3 p-3 ${key === 'total' ? 'font-semibold' : ''}`}
                          >
                            <dt>{copy(key)}</dt>
                            <dd>
                              <bdi>{numbers.money(value)}</bdi>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                  <p className="text-sm">
                    {copy('walletBalance')}:{' '}
                    {walletBalance === null ? '—' : numbers.money(walletBalance)}
                  </p>
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
              <div className="flex justify-between gap-3 border-t pt-4">
                <Button
                  variant="outline"
                  disabled={step === 1 || submitting}
                  onClick={() => setStep((value) => value - 1)}
                >
                  {copy('back')}
                </Button>
                {step < 6 ? (
                  <Button disabled={!canNext} onClick={() => setStep((value) => value + 1)}>
                    {copy('next')}
                  </Button>
                ) : (
                  <Button
                    disabled={!quote || !submitForReview || submitting}
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
