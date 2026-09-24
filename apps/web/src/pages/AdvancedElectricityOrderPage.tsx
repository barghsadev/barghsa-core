import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button, Card, CardContent, DateTimePicker } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { toast } from 'sonner';
import { FormWizard } from '../components/FormWizard.js';
import { WalletFundingPrompt } from '../components/WalletFundingPrompt.js';
import { ElectricityQuoteErrorNotice } from '../components/ElectricityQuoteErrorNotice.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';
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

export function JalaliTimeInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const locale = useLocale();
  const instant = parseJalaliDateTime(value);
  return (
    <DateTimePicker
      id={id}
      label={label}
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
  const [start, setStart] = useState(() => formatJalaliDateTime(new Date(Date.now() + 86_400_000)));
  const [end, setEnd] = useState(() =>
    formatJalaliDateTime(new Date(Date.now() + 31 * 86_400_000))
  );
  const [quantities, setQuantities] = useState<Record<Key, string>>(emptyQuantities);
  const [addressId, setAddressId] = useState('');
  const [giftCode, setGiftCode] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [draftAttempt, setDraftAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(1);
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
  const validPeriod = Boolean(
    startAt &&
    endAt &&
    options &&
    new Date(startAt) >= new Date() &&
    new Date(endAt) > new Date(startAt) &&
    civilDay(new Date(startAt)) >=
      civilDay(new Date()) + options.limits.leadTimeDays * 86_400_000 &&
    (() => {
      const months =
        (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
        Number(end.slice(5, 7)) -
        Number(start.slice(5, 7));
      return (
        months < options.limits.maxContractDuration ||
        (months === options.limits.maxContractDuration && end.slice(8) <= start.slice(8))
      );
    })()
  );
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
    const abort = new AbortController();
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
          draft.currentStep > 5
        )
          throw new Error('Invalid draft');
        setAddresses(addressData.addresses);
        setAddressId(
          draft.data?.addressId ??
            (
              addressData.addresses.find((address) => address.mainAddress) ??
              addressData.addresses[0]
            )?.id ??
            ''
        );
        if (draft.data) {
          if (draft.data.startAt) setStart(formatJalaliDateTime(new Date(draft.data.startAt)));
          if (draft.data.endAt) setEnd(formatJalaliDateTime(new Date(draft.data.endAt)));
          setQuantities({ ...emptyQuantities, ...draft.data.quantities });
          setGiftCode(draft.data.giftCode ?? '');
        }
        setStep(draft.currentStep);
        setLoadError(false);
        setLoading(false);
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setLoadError(true);
          setLoading(false);
        }
      });
    return () => abort.abort();
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
  }, [profileId, blocked, validPeriod, quantitiesValid, options, previewInput, locale]);

  async function saveDraft(next: boolean) {
    if (!profileId) return false;
    setSaving(true);
    try {
      const response = await fetch('/api/electricity/drafts/advanced', {
        method: 'PUT',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          profileId,
          currentStep: next ? Math.min(5, step + 1) : step,
          data: {
            ...(startAt ? { startAt } : {}),
            ...(endAt ? { endAt } : {}),
            quantities: quantityPayload,
            ...(giftCode.trim() ? { giftCode: giftCode.trim() } : {}),
            ...(addressId ? { addressId } : {}),
          },
        }),
      });
      if (!response.ok) throw new Error('Draft failed');
      const saved: unknown = await response.json();
      if (
        !saved ||
        typeof saved !== 'object' ||
        !('currentStep' in saved) ||
        saved.currentStep !== (next ? Math.min(5, step + 1) : step)
      )
        throw new Error('Draft save was not confirmed');
      if (next) setStep((current) => Math.min(5, current + 1));
      else toast.success(t('electricity.order.draftSaved', locale));
      return true;
    } catch {
      toast.error(t('electricity.order.draftSaveFailed', locale));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function openAddresses() {
    if (!(await saveDraft(false))) return;
    await navigate({ to: '/settings/addresses', search: { returnTo: '/electricity/advanced' } });
  }

  async function submit() {
    if (!profileId || !selectedAddress || !quote || !startAt || !endAt) return;
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
      if (!response.ok) throw new Error('Order failed');
      const result = (await response.json()) as { orderId: string };
      await navigate({ to: '/electricity/orders/$orderId', params: { orderId: result.orderId } });
    } catch {
      toast.error(t('electricity.order.submitFailed', locale));
    } finally {
      setSubmitting(false);
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
    t('electricity.order.giftCode', locale),
    t('electricity.advanced.stepConfirm', locale),
  ];
  return (
    <main className="mx-auto max-w-4xl space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header>
        <h1 className="text-2xl font-semibold">{t('electricity.advanced.title', locale)}</h1>
        <p className="text-sm text-muted-foreground">
          {t('electricity.advanced.description', locale)}
        </p>
      </header>
      <FormWizard
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
        saveDisabled={false}
        nextDisabled={step === 1 ? !validPeriod : !quote}
        submitDisabled={!quote || !selectedAddress || !validPeriod || submitting}
        onBack={() => setStep((current) => Math.max(1, current - 1))}
        onSave={() => void saveDraft(false)}
        onNext={() => void saveDraft(true)}
        onSubmit={() => void submit()}
      >
        {step === 1 && (
          <Card className="mb-6">
            <CardContent className="space-y-4 pt-6">
              <JalaliTimeInput
                id="advanced-start"
                label={t('electricity.advanced.start', locale)}
                value={start}
                onChange={setStart}
              />
              <JalaliTimeInput
                id="advanced-end"
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
                    <label htmlFor={`advanced-${product.systemKey}`} className="block font-medium">
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
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      className={`${fieldClass} mt-2`}
                      value={
                        locked
                          ? (quote?.lines.find((line) => line.systemKey === 'green')?.quantityKwh ??
                            '0')
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
        {step === 5 && (
          <Card className="mb-6">
            <CardContent className="space-y-3 pt-6">
              <h2 className="font-semibold">{t('electricity.order.selectAddress', locale)}</h2>
              {addresses.map((address) => (
                <label key={address.id} className="flex gap-3 rounded-lg border p-3">
                  <input
                    type="radio"
                    name="advanced-address"
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
                  <p>
                    {t('electricity.order.period.selection', locale)}: {start} – {end}
                  </p>
                  <p>
                    {t('electricity.order.quantity', locale)}: {numbers.irrDigits(quote.totalKwh)}{' '}
                    kWh ·{t('electricity.order.averagePower', locale)}: {quote.averagePowerKw} kW ·{' '}
                    {quote.durationHours} h
                  </p>
                  {quote.greenRuleApplies && <p>{t('electricity.order.mandatoryGreen', locale)}</p>}
                  {quote.lines.map((line) => (
                    <div key={line.systemKey} className="border-b py-2 text-sm">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span>
                          {t(`electricity.catalogue.${line.systemKey}`, locale)} ·{' '}
                          {numbers.irrDigits(line.quantityKwh)} kWh ×{' '}
                          {numbers.money(line.unitPriceIrR)}
                        </span>
                        <strong>
                          {t('electricity.order.lineTotal', locale)}: {numbers.money(line.totalIrR)}
                        </strong>
                      </div>
                      <p className="text-muted-foreground">
                        {numbers.money(line.subtotalIrR)} · −{numbers.money(line.discountIrR)} · +
                        {numbers.money(line.vatIrR)}
                      </p>
                    </div>
                  ))}
                  <p>
                    {t('electricity.order.discount', locale)}: {numbers.money(quote.discountIrR)}
                  </p>
                  <p>
                    {t('electricity.order.vat', locale)}: {numbers.money(quote.vatIrR)}
                  </p>
                  <p className="font-semibold">
                    {t('electricity.order.total', locale)}: {numbers.money(quote.totalIrR)}
                  </p>
                  <p>
                    {t('electricity.order.walletBalance', locale)}:{' '}
                    {numbers.money(quote.walletBalanceIrR)}
                  </p>
                  {step === 5 && (
                    <WalletFundingPrompt balance={quote.walletBalanceIrR} total={quote.totalIrR} />
                  )}
                  {step === 5 && (
                    <>
                      <p>
                        {t('electricity.order.profile', locale)}:{' '}
                        <strong dir="auto">{profileName || profileId}</strong>
                        {profileName ? (
                          <small className="ms-2 text-muted-foreground" dir="ltr">
                            {profileId}
                          </small>
                        ) : null}
                      </p>
                      <p>
                        {t('electricity.order.giftCode', locale)}: {giftCode.trim() || '—'}
                      </p>
                      <p>
                        {t('electricity.order.deliveryAddress', locale)}:{' '}
                        {selectedAddress?.fullAddress}
                      </p>
                      <p>
                        {t('electricity.order.postalCode', locale)}: {selectedAddress?.postalCode}
                      </p>
                      <div className="space-y-2 border-t pt-4 text-sm text-muted-foreground">
                        <h3 className="font-medium text-foreground">
                          {t('electricity.order.contractPreview', locale)}
                        </h3>
                        <p>{t('electricity.order.contractPreviewText', locale)}</p>
                        <h3 className="font-medium text-foreground">
                          {t('electricity.order.cancellationRules', locale)}
                        </h3>
                        <p>{t('electricity.order.cancellationRulesText', locale)}</p>
                        <p>{t('electricity.order.paymentAfterSubmit', locale)}</p>
                      </div>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </FormWizard>
    </main>
  );
}
