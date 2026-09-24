import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/app';
import { Button } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';
import { formatJalaliDateTime, parseJalaliDateTime } from '../lib/jalali-date-time.js';
import { JalaliTimeInput } from './AdvancedElectricityOrderPage.js';

type SystemKey = 'thermal' | 'green' | 'free_market' | 'energy_saving';
type PeriodKey = 'current_month' | 'next_month' | 'current_week' | 'next_week' | 'week_after_next';
const systemKeys: SystemKey[] = ['thermal', 'green', 'free_market', 'energy_saving'];
const periodLabels: Record<PeriodKey, string> = {
  current_month: 'electricity.order.period.currentMonth',
  next_month: 'electricity.order.period.nextMonth',
  current_week: 'electricity.order.period.currentWeek',
  next_week: 'electricity.order.period.nextWeek',
  week_after_next: 'electricity.order.period.weekAfterNext',
};

export interface RevisableElectricityOrder {
  orderId: string;
  profileId: string;
  mode: string;
  versionId: string;
  periodStart: string;
  periodEnd: string;
  totalKwh: string;
  fullAddress: string;
  postalCode: string;
  provinceId: string;
  cityId: string;
  giftCode?: string | null;
  totalIrR: string;
  lines?: Array<{
    systemKey: string | null;
    title: Record<string, string> | null;
    quantityKwh: string;
  }>;
}

type Review = {
  reviewDigest: string;
  totalIrR: string;
  totalKwh: string;
  subtotalIrR: string;
  discountIrR: string;
  vatIrR: string;
  lines: Array<{ systemKey: string; quantityKwh: string; subtotalIrR: string }>;
};
type Place = { id: string; nameFa: string; nameEn: string; provinceId?: string };

export function ElectricityOrderRevisionForm({
  order,
  onComplete,
}: {
  order: RevisableElectricityOrder;
  onComplete: () => void;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const advanced = order.mode === 'advanced';
  const [periods, setPeriods] = useState<Array<{ key: PeriodKey; start: string; end: string }>>([]);
  const [period, setPeriod] = useState<PeriodKey>('next_week');
  const [start, setStart] = useState(() => formatJalaliDateTime(new Date(order.periodStart)));
  const [end, setEnd] = useState(() => formatJalaliDateTime(new Date(order.periodEnd)));
  const [quantity, setQuantity] = useState(order.totalKwh);
  const [quantities, setQuantities] = useState<Record<SystemKey, string>>(
    () =>
      Object.fromEntries(
        systemKeys.map((key) => [
          key,
          order.lines?.find((line) => line.systemKey === key)?.quantityKwh ?? '0',
        ])
      ) as Record<SystemKey, string>
  );
  const [mandatoryGreen, setMandatoryGreen] = useState(false);
  const [giftCode, setGiftCode] = useState(order.giftCode ?? '');
  const [address, setAddress] = useState(order.fullAddress);
  const [postalCode, setPostalCode] = useState(order.postalCode);
  const [provinceId, setProvinceId] = useState(order.provinceId);
  const [cityId, setCityId] = useState(order.cityId);
  const [provinces, setProvinces] = useState<Place[]>([]);
  const [cities, setCities] = useState<Place[]>([]);
  const [responseNote, setResponseNote] = useState('');
  const [review, setReview] = useState<{ fingerprint: string; quote: Review } | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    const url = advanced ? '/api/electricity/periods/advanced' : '/api/electricity/periods/simple';
    void fetch(url, { credentials: 'include', signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Period options unavailable');
        return response.json();
      })
      .then((value) => {
        if (abort.signal.aborted) return;
        if (advanced) {
          setMandatoryGreen(Boolean(value.mandatoryGreenEnabled));
        } else {
          const options = value.periods as Array<{ key: PeriodKey; start: string; end: string }>;
          setPeriods(options);
          const current = options.find(
            (option) => option.start === order.periodStart && option.end === order.periodEnd
          );
          if (current) setPeriod(current.key);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [advanced, order.periodStart, order.periodEnd]);

  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/geography/provinces', { credentials: 'include', signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Provinces unavailable');
        return response.json() as Promise<unknown>;
      })
      .then((value) => {
        if (!abort.signal.aborted && Array.isArray(value)) setProvinces(value as Place[]);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    if (!provinceId) return () => abort.abort();
    void fetch(`/api/geography/provinces/${encodeURIComponent(provinceId)}/cities`, {
      credentials: 'include',
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Cities unavailable');
        return response.json() as Promise<unknown>;
      })
      .then((value) => {
        if (!abort.signal.aborted && Array.isArray(value)) setCities(value as Place[]);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [provinceId]);

  const terms = useMemo(() => {
    const common = {
      profileId: order.profileId,
      expectedVersionId: order.versionId,
      ...(giftCode.trim() ? { giftCode: giftCode.trim() } : {}),
    };
    if (!advanced) return { ...common, period, totalKwh: quantity.trim() };
    return {
      ...common,
      startAt: parseJalaliDateTime(start),
      endAt: parseJalaliDateTime(end),
      quantities: Object.fromEntries(
        systemKeys.map((system) => [
          system,
          system === 'green' && mandatoryGreen ? '0' : quantities[system].trim() || '0',
        ])
      ),
    };
  }, [
    advanced,
    order.profileId,
    order.versionId,
    giftCode,
    period,
    quantity,
    start,
    end,
    quantities,
    mandatoryGreen,
  ]);
  const fingerprint = JSON.stringify([
    terms,
    provinceId,
    cityId,
    address.trim(),
    postalCode.trim(),
    responseNote.trim(),
  ]);
  const currentReview = review?.fingerprint === fingerprint ? review.quote : null;
  const canReview = Boolean(
    provinceId &&
    cityId &&
    address.trim() &&
    /^\d{10}$/.test(postalCode.trim()) &&
    responseNote.trim() &&
    (advanced
      ? 'startAt' in terms &&
        terms.startAt &&
        terms.endAt &&
        Object.values(terms.quantities).some((value) => Number(value) > 0)
      : periods.length > 0 && /^\d{1,19}$/.test(quantity) && BigInt(quantity) > 0n)
  );

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canReview || busy) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/electricity/orders/${encodeURIComponent(order.orderId)}/revision-preview`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(terms),
        }
      );
      if (!response.ok) throw new Error('Quote unavailable');
      setReview({ fingerprint, quote: (await response.json()) as Review });
      setKey(crypto.randomUUID());
    } catch {
      setReview(null);
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function resubmit() {
    if (!currentReview || busy) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/electricity/orders/${encodeURIComponent(order.orderId)}/resubmit`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            ...terms,
            idempotencyKey: key,
            expectedQuoteDigest: currentReview.reviewDigest,
            address: {
              provinceId,
              cityId,
              fullAddress: address.trim(),
              postalCode: postalCode.trim(),
            },
            responseNote: responseNote.trim(),
          }),
        }
      );
      if (!response.ok) throw new Error('Resubmission failed');
      onComplete();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 border-t pt-5">
      <h3 className="font-semibold">{t('electricity.order.revision.title', locale)}</h3>
      <p className="text-sm text-muted-foreground">
        {t('electricity.order.revision.description', locale)}
      </p>
      <form onSubmit={(event) => void preview(event)} className="space-y-4">
        {advanced ? (
          <>
            <JalaliTimeInput
              id="revision-start"
              label={t('electricity.advanced.start', locale)}
              value={start}
              onChange={setStart}
            />
            <JalaliTimeInput
              id="revision-end"
              label={t('electricity.advanced.end', locale)}
              value={end}
              onChange={setEnd}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {systemKeys.map((system) => (
                <label key={system} className="text-sm">
                  {order.lines?.find((line) => line.systemKey === system)?.title?.[locale] ??
                    t(`electricity.order.revision.${system}`, locale)}{' '}
                  (kWh)
                  <input
                    className="mt-1 w-full rounded-md border bg-background p-2"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={19}
                    disabled={system === 'green' && mandatoryGreen}
                    value={system === 'green' && mandatoryGreen ? '0' : quantities[system]}
                    onChange={(event) =>
                      setQuantities((current) => ({ ...current, [system]: event.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            {mandatoryGreen ? (
              <p className="text-sm text-muted-foreground">
                {t('electricity.advanced.greenDerived', locale)}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <label className="block text-sm">
              {t('electricity.order.period.selection', locale)}
              <select
                className="mt-1 w-full rounded-md border bg-background p-2"
                value={period}
                onChange={(event) => setPeriod(event.target.value as PeriodKey)}
                required
              >
                {periods.map((option) => (
                  <option key={option.key} value={option.key}>
                    {t(periodLabels[option.key], locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {t('electricity.order.quantity', locale)} (kWh)
              <input
                className="mt-1 w-full rounded-md border bg-background p-2"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={19}
                required
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
          </>
        )}
        <label className="block text-sm">
          {t('electricity.order.giftCode', locale)}
          <input
            className="mt-1 w-full rounded-md border bg-background p-2"
            value={giftCode}
            maxLength={100}
            onChange={(event) => setGiftCode(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          {t('electricity.order.deliveryAddress', locale)}
          <input
            className="mt-1 w-full rounded-md border bg-background p-2"
            value={address}
            maxLength={500}
            required
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            {t('electricity.order.revision.province', locale)}
            <select
              className="mt-1 w-full rounded-md border bg-background p-2"
              value={provinceId}
              onChange={(event) => {
                setProvinceId(event.target.value);
                setCityId('');
                setCities([]);
              }}
            >
              {!provinces.some((place) => place.id === provinceId) && provinceId ? (
                <option value={provinceId}>
                  {t('electricity.order.revision.currentProvince', locale)}
                </option>
              ) : null}
              {provinces.map((place) => (
                <option key={place.id} value={place.id}>
                  {locale === 'fa' ? place.nameFa : place.nameEn}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t('electricity.order.revision.city', locale)}
            <select
              className="mt-1 w-full rounded-md border bg-background p-2"
              value={cityId}
              onChange={(event) => setCityId(event.target.value)}
            >
              {!cities.some((place) => place.id === cityId) && cityId ? (
                <option value={cityId}>
                  {t('electricity.order.revision.currentCity', locale)}
                </option>
              ) : null}
              <option value="">{t('electricity.order.revision.selectCity', locale)}</option>
              {cities.map((place) => (
                <option key={place.id} value={place.id}>
                  {locale === 'fa' ? place.nameFa : place.nameEn}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          {t('electricity.order.correction.postalCode', locale)}
          <input
            className="mt-1 w-full rounded-md border bg-background p-2"
            value={postalCode}
            inputMode="numeric"
            maxLength={10}
            required
            onChange={(event) => setPostalCode(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          {t('electricity.order.correction.responseNote', locale)}
          <textarea
            className="mt-1 w-full rounded-md border bg-background p-2"
            value={responseNote}
            maxLength={1000}
            required
            onChange={(event) => setResponseNote(event.target.value)}
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t('electricity.order.revision.error', locale)}
          </p>
        ) : null}
        <Button type="submit" variant="outline" disabled={busy || !canReview}>
          {t('electricity.order.revision.preview', locale)}
        </Button>
      </form>
      {currentReview ? (
        <div className="space-y-3 rounded-md border p-4" role="status">
          <p className="font-medium">{t('electricity.order.revision.review', locale)}</p>
          <p>
            {t('electricity.order.quantity', locale)}: {numbers.irrDigits(currentReview.totalKwh)}{' '}
            kWh
          </p>
          <ul className="space-y-1 text-sm">
            {currentReview.lines.map((line) => (
              <li key={line.systemKey} className="flex justify-between gap-3">
                <span>
                  {t(`electricity.order.revision.${line.systemKey}`, locale)} ·{' '}
                  {numbers.irrDigits(line.quantityKwh)} kWh
                </span>
                <span>{numbers.money(line.subtotalIrR)}</span>
              </li>
            ))}
          </ul>
          <p>
            {t('electricity.order.detail.subtotal', locale)}:{' '}
            {numbers.money(currentReview.subtotalIrR)}
          </p>
          <p>
            {t('electricity.order.detail.giftDiscount', locale)}:{' '}
            {numbers.money(currentReview.discountIrR)}
          </p>
          <p>
            {t('electricity.order.vat', locale)}: {numbers.money(currentReview.vatIrR)}
          </p>
          <p>
            {t('electricity.order.total', locale)}:{' '}
            <strong>{numbers.money(currentReview.totalIrR)}</strong>
          </p>
          <p className="text-sm text-muted-foreground">
            {t('electricity.order.revision.replacesInvoice', locale)}
          </p>
          <Button type="button" disabled={busy} onClick={() => void resubmit()}>
            {t('electricity.order.correction.submit', locale)}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
