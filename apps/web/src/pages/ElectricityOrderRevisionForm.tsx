import { OrderWalletBalance } from '../components/OrderWalletBalance.js';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ComponentProps,
  type AriaAttributes,
} from 'react';
import { t } from '@barghsa/i18n/app';
import { Button, DependentSelect, Input, Textarea, DateTimePicker } from '@barghsa/ui';
import { useGeographyOptions } from '../hooks/useGeographyOptions.js';
import { GeographyLoadError } from '../components/GeographyLoadError.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';
import { formatJalaliDateTime, parseJalaliDateTime } from '../lib/jalali-date-time.js';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@barghsa/ui/form';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  correctionRecord,
  definitiveElectricityRejection,
  electricityCorrectionReceipt,
  electricityRevisionQuote,
  type ElectricityCorrectionLock,
  type ElectricityRevisionDraft,
  type ElectricityRevisionQuote,
} from '../lib/electricity-correction-form.js';

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
  contractId?: string;
  invoiceId?: string;
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

function RevisionDateControl({
  id,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
  ...props
}: ComponentProps<typeof DateTimePicker> &
  Pick<AriaAttributes, 'aria-invalid' | 'aria-describedby'>) {
  return (
    <DateTimePicker
      {...props}
      {...(id ? { id: id.replace(/-date$/, '') } : {})}
      triggerProps={{
        ...props.triggerProps,
        'aria-invalid': invalid,
        'aria-describedby': describedBy,
      }}
    />
  );
}
const systemFields = {
  thermal: 'thermal',
  green: 'green',
  free_market: 'freeMarket',
  energy_saving: 'energySaving',
} as const;
interface CapturedRevision {
  body: string;
  review: ElectricityRevisionQuote;
  snapshot: RevisableElectricityOrder & { contractId: string };
  generation: number;
}

export function ElectricityOrderRevisionForm({
  order,
  onComplete,
  onDenied,
  coordination,
}: {
  order: RevisableElectricityOrder;
  onComplete: () => void;
  onDenied?: () => void;
  coordination?: ElectricityCorrectionLock;
}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const numbers = useNumberFormatting(locale);
  const advanced = order.mode === 'advanced';
  const scopeKey = JSON.stringify([actor, order.orderId, order.profileId, order.versionId]);
  const scope = useRef(scopeKey);
  const generation = useRef(0);
  if (scope.current !== scopeKey) {
    scope.current = scopeKey;
    ++generation.current;
  }
  const [acceptedScope, setAcceptedScope] = useState(scopeKey);
  const callbacks = useRef({ onComplete, onDenied });
  callbacks.current = { onComplete, onDenied };
  const [periods, setPeriods] = useState<Array<{ key: PeriodKey; start: string; end: string }>>([]);
  const [mandatoryGreen, setMandatoryGreen] = useState(false);
  const [optionsReady, setOptionsReady] = useState(false);
  const initial = (): ElectricityRevisionDraft => ({
    period: 'next_week',
    totalKwh: order.totalKwh,
    startAt: formatJalaliDateTime(new Date(order.periodStart)),
    endAt: formatJalaliDateTime(new Date(order.periodEnd)),
    thermal: order.lines?.find((line) => line.systemKey === 'thermal')?.quantityKwh ?? '0',
    green: order.lines?.find((line) => line.systemKey === 'green')?.quantityKwh ?? '0',
    freeMarket: order.lines?.find((line) => line.systemKey === 'free_market')?.quantityKwh ?? '0',
    energySaving:
      order.lines?.find((line) => line.systemKey === 'energy_saving')?.quantityKwh ?? '0',
    giftCode: order.giftCode ?? '',
    fullAddress: order.fullAddress,
    postalCode: order.postalCode,
    provinceId: order.provinceId,
    cityId: order.cityId,
    responseNote: '',
  });
  const copy = (name: string) => t(`electricity.correctionForm.${name}`, locale);
  const messages: Record<keyof ElectricityRevisionDraft, string> = {
    fullAddress: copy('addressInvalid'),
    postalCode: copy('postalInvalid'),
    responseNote: copy('noteInvalid'),
    giftCode: copy('giftInvalid'),
    provinceId: copy('locationInvalid'),
    cityId: copy('locationInvalid'),
    period: t('formWizard.invalidField', locale),
    totalKwh: t('electricity.order.quantityInvalid', locale),
    startAt: t('formWizard.invalidField', locale),
    endAt: t('formWizard.invalidField', locale),
    thermal: t('electricity.order.quantityInvalid', locale),
    green: t('electricity.order.quantityInvalid', locale),
    freeMarket: t('electricity.order.quantityInvalid', locale),
    energySaving: t('electricity.order.quantityInvalid', locale),
  };
  const validationOptions = useRef({
    advanced,
    mandatoryGreen,
    periods: [] as string[],
    locationValid: false,
  });
  const form = useZodForm<ElectricityRevisionDraft>(
    async () => {
      const token = generation.current;
      const options = { ...validationOptions.current };
      const schemas = await import('../lib/electricity-correction-form-schemas.js');
      return schemas.electricityRevisionSchema(
        messages,
        token === generation.current ? options : { ...options, periods: [], locationValid: false }
      );
    },
    { defaultValues: initial(), validationUnavailableMessage: copy('validationUnavailable') }
  );
  const fields = form.watch();
  const { provinceId, cityId } = fields;
  const provinceOptions = useGeographyOptions('/api/geography/provinces');
  const cityOptions = useGeographyOptions(
    provinceId ? `/api/geography/provinces/${encodeURIComponent(provinceId)}/cities` : null,
    provinceId || undefined
  );
  const provinces = provinceOptions.options,
    cities = cityOptions.options;
  const locationValid =
    (provinceId === order.provinceId && cityId === order.cityId) ||
    (provinceOptions.ready &&
      cityOptions.ready &&
      provinces.some((place) => place.id === provinceId) &&
      cities.some((place) => place.id === cityId));
  validationOptions.current = {
    advanced,
    mandatoryGreen,
    periods: periods.map((value) => value.key),
    locationValid,
  };
  const fieldErrors = useActionFieldErrors(
    form,
    messages,
    t('electricity.order.revision.error', locale)
  );
  const [review, setReview] = useState<{
    fingerprint: string;
    quote: ElectricityRevisionQuote;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const attempt = useRef<CapturedRevision | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  const localLock = useMemo<ElectricityCorrectionLock>(() => {
    const lock: ElectricityCorrectionLock = {
      owner: null,
      acquire(owner) {
        if (lock.owner) return false;
        lock.owner = owner;
        return true;
      },
      release(owner) {
        if (lock.owner === owner) lock.owner = null;
      },
    };
    return lock;
  }, [scopeKey]);
  const lock = coordination ?? localLock;
  function withdraw() {
    ++generation.current;
    attempt.current = null;
    pending.current = false;
    lock.release('revision');
    setBusy(false);
    setUnconfirmed(false);
    setReview(null);
    setDenied(true);
    form.reset({ ...initial(), fullAddress: '', postalCode: '', responseNote: '', giftCode: '' });
    callbacks.current.onDenied?.();
  }
  useEffect(() => {
    attempt.current = null;
    pending.current = false;
    setBusy(false);
    setUnconfirmed(false);
    setReview(null);
    setError(false);
    setDenied(false);
    setAcceptedScope(scopeKey);
    form.reset(initial());
    return () => {
      ++generation.current;
    };
  }, [scopeKey]);
  useEffect(() => {
    const abort = new AbortController();
    const token = generation.current;
    setPeriods([]);
    setMandatoryGreen(false);
    setOptionsReady(false);
    void fetch(advanced ? '/api/electricity/periods/advanced' : '/api/electricity/periods/simple', {
      credentials: 'include',
      signal: abort.signal,
    })
      .then(async (response) => {
        if (abort.signal.aborted || token !== generation.current) return null;
        if ([401, 403, 404].includes(response.status)) {
          withdraw();
          return null;
        }
        if (!response.ok) throw new Error('Period options unavailable');
        return response.json() as Promise<unknown>;
      })
      .then((value) => {
        if (abort.signal.aborted || token !== generation.current || !value) return;
        if (!correctionRecord(value)) throw new Error('Period options unavailable');
        if (advanced) {
          if (typeof value.mandatoryGreenEnabled !== 'boolean')
            throw new Error('Period options unavailable');
          setMandatoryGreen(value.mandatoryGreenEnabled);
        } else {
          if (
            !Array.isArray(value.periods) ||
            !value.periods.length ||
            !value.periods.every(
              (item) =>
                correctionRecord(item) &&
                typeof item.key === 'string' &&
                Object.hasOwn(periodLabels, item.key) &&
                typeof item.start === 'string' &&
                Number.isFinite(Date.parse(item.start)) &&
                typeof item.end === 'string' &&
                Date.parse(item.end) > Date.parse(item.start)
            )
          )
            throw new Error('Period options unavailable');
          const options = value.periods as Array<{ key: PeriodKey; start: string; end: string }>;
          setPeriods(options);
          const current = options.find(
            (item) =>
              Date.parse(item.start) === Date.parse(order.periodStart) &&
              Date.parse(item.end) === Date.parse(order.periodEnd)
          );
          if (current) form.setValue('period', current.key);
        }
        setOptionsReady(true);
      })
      .catch(() => {
        if (!abort.signal.aborted && token === generation.current) setError(true);
      });
    return () => abort.abort();
  }, [scopeKey, advanced, order.periodStart, order.periodEnd]);

  const terms = useMemo(() => {
    const common = {
      profileId: order.profileId,
      expectedVersionId: order.versionId,
      ...(fields.giftCode.trim() ? { giftCode: fields.giftCode.trim() } : {}),
    };
    return advanced
      ? {
          ...common,
          startAt: parseJalaliDateTime(fields.startAt),
          endAt: parseJalaliDateTime(fields.endAt),
          quantities: Object.fromEntries(
            systemKeys.map((key) => [
              key,
              key === 'green' && mandatoryGreen ? '0' : fields[systemFields[key]].trim() || '0',
            ])
          ),
        }
      : { ...common, period: fields.period, totalKwh: fields.totalKwh.trim() };
  }, [fields, order.profileId, order.versionId, advanced, mandatoryGreen]);
  const fingerprint = JSON.stringify([
    terms,
    provinceId,
    cityId,
    fields.fullAddress.trim(),
    fields.postalCode.trim(),
    fields.responseNote.trim(),
  ]);
  const currentReview = review?.fingerprint === fingerprint ? review.quote : null;
  const live = acceptedScope === scopeKey && !denied;
  // Read-only validation/preview keeps its own controls focusable. Captured writes freeze both forms.
  const locked =
    !!attempt.current || (lock.owner !== null && lock.owner !== 'revision') || unconfirmed || !live;
  function bindQuote(value: ElectricityRevisionQuote, captured: typeof terms) {
    if (advanced) {
      if (
        !('startAt' in captured) ||
        !captured.startAt ||
        !captured.endAt ||
        Date.parse(value.periodStart) !== Date.parse(captured.startAt) ||
        Date.parse(value.periodEnd) !== Date.parse(captured.endAt)
      )
        return false;
      return systemKeys.every(
        (key) =>
          (key === 'green' && mandatoryGreen) ||
          BigInt(value.lines.find((line) => line.systemKey === key)?.quantityKwh ?? '0') ===
            BigInt(captured.quantities[key] ?? '0')
      );
    }
    const period = periods.find((option) => option.key === fields.period);
    return (
      !!period &&
      Date.parse(value.periodStart) === Date.parse(period.start) &&
      Date.parse(value.periodEnd) === Date.parse(period.end) &&
      value.lines.find((line) => line.systemKey === 'thermal')?.quantityKwh ===
        fields.totalKwh.trim()
    );
  }
  function showFields(response: Response, value: unknown) {
    return (
      response.status === 400 &&
      correctionRecord(value) &&
      correctionRecord(value.error) &&
      value.error.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
      Array.isArray(value.error.fields) &&
      fieldErrors(value.error.fields)
    );
  }
  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (scope.current !== scopeKey) return;
    if (
      !live ||
      !optionsReady ||
      pending.current ||
      attempt.current ||
      !locationValid ||
      !lock.acquire('revision')
    )
      return;
    const token = generation.current;
    const raw = JSON.stringify(form.getValues());
    const captured = terms;
    pending.current = true;
    setBusy(true);
    setError(false);
    setReview(null);
    try {
      await form.handleSubmit(async () => {
        if (token !== generation.current || raw !== JSON.stringify(form.getValues())) return;
        const response = await fetch(
          `/api/electricity/orders/${encodeURIComponent(order.orderId)}/revision-preview`,
          {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(captured),
          }
        );
        const value: unknown = await response.json().catch(() => null);
        if (token !== generation.current) return;
        if ([401, 403, 404].includes(response.status)) {
          withdraw();
          return;
        }
        if (raw !== JSON.stringify(form.getValues())) return;
        if (!response.ok) {
          if (showFields(response, value)) return;
          throw new Error('Quote unavailable');
        }
        if (!electricityRevisionQuote(value) || !bindQuote(value, captured))
          throw new Error('Quote mismatch');
        if (raw !== JSON.stringify(form.getValues())) return;
        setReview({ fingerprint, quote: value });
      })();
    } catch {
      if (token === generation.current) setError(true);
    } finally {
      if (token === generation.current) {
        pending.current = false;
        setBusy(false);
        lock.release('revision');
      }
    }
  }
  async function send(retrying: boolean) {
    if (scope.current !== scopeKey) return;
    const captured = attempt.current;
    if (!captured || captured.generation !== generation.current) return;
    try {
      const response = await fetch(
        `/api/electricity/orders/${encodeURIComponent(order.orderId)}/resubmit`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: captured.body,
        }
      );
      const value: unknown = await response.json().catch(() => null);
      if (captured !== attempt.current || captured.generation !== generation.current) return;
      if ([401, 403, 404].includes(response.status)) {
        withdraw();
        return;
      }
      if (!response.ok) {
        if (
          !retrying &&
          response.status >= 400 &&
          response.status < 500 &&
          definitiveElectricityRejection(value)
        ) {
          attempt.current = null;
          setUnconfirmed(false);
          setReview(null);
          lock.release('revision');
          if (showFields(response, value)) return;
          setError(true);
          return;
        }
        throw new Error('Correction unconfirmed');
      }
      if (!electricityCorrectionReceipt(value, captured.snapshot, captured.review))
        throw new Error('Correction unconfirmed');
      attempt.current = null;
      setUnconfirmed(false);
      setReview(null);
      lock.release('revision');
      callbacks.current.onComplete();
    } catch {
      if (captured === attempt.current && captured.generation === generation.current) {
        setUnconfirmed(true);
        setError(true);
      }
    }
  }
  async function resubmit() {
    if (scope.current !== scopeKey) return;
    if (
      !live ||
      !currentReview ||
      !order.contractId ||
      pending.current ||
      attempt.current ||
      !lock.acquire('revision')
    )
      return;
    const token = generation.current;
    pending.current = true;
    setBusy(true);
    setError(false);
    attempt.current = {
      body: JSON.stringify({
        ...terms,
        idempotencyKey: crypto.randomUUID(),
        expectedQuoteDigest: currentReview.reviewDigest,
        address: {
          provinceId,
          cityId,
          fullAddress: fields.fullAddress.trim(),
          postalCode: fields.postalCode.trim(),
        },
        responseNote: fields.responseNote.trim(),
      }),
      review: currentReview,
      snapshot: { ...order, contractId: order.contractId },
      generation: token,
    };
    try {
      await send(false);
    } finally {
      if (token === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function retry() {
    if (scope.current !== scopeKey) return;
    if (!live || pending.current || !attempt.current || lock.owner !== 'revision') return;
    const token = generation.current;
    pending.current = true;
    setBusy(true);
    setError(false);
    try {
      await send(true);
    } finally {
      if (token === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  const text = (
    name: keyof ElectricityRevisionDraft,
    label: string,
    id: string,
    maxLength: number,
    numeric = false,
    multiline = false
  ) => (
    <FormField
      key={name}
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem id={id}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {multiline ? (
              <Textarea {...field} disabled={locked} maxLength={maxLength} />
            ) : (
              <Input
                {...field}
                disabled={locked}
                maxLength={maxLength}
                inputMode={numeric ? 'numeric' : 'text'}
              />
            )}
          </FormControl>
          <FormDescription>{copy('help')}</FormDescription>
          <div className="grid">
            <p aria-hidden="true" className="invisible col-start-1 row-start-1 text-sm">
              {messages[name]}
            </p>
            <FormMessage className="col-start-1 row-start-1" />
          </div>
        </FormItem>
      )}
    />
  );
  const message = (name: keyof ElectricityRevisionDraft) => (
    <>
      <FormDescription>{copy('help')}</FormDescription>
      <div className="grid">
        <p aria-hidden="true" className="invisible col-start-1 row-start-1 text-sm">
          {messages[name]}
        </p>
        <FormMessage className="col-start-1 row-start-1" />
      </div>
    </>
  );
  if (!live) return <p role="alert">{t('electricity.order.revision.error', locale)}</p>;
  return (
    <section className="space-y-4 border-t pt-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h3 className="font-semibold">{t('electricity.order.revision.title', locale)}</h3>
      <p className="text-sm text-muted-foreground">
        {t('electricity.order.revision.description', locale)}
      </p>
      <Form {...form}>
        <form
          noValidate
          data-testid="electricity-revision-form"
          onSubmit={(event) => void preview(event)}
          className="space-y-4"
        >
          {advanced ? (
            <>
              {(['startAt', 'endAt'] as const).map((name) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem id={name === 'startAt' ? 'revision-start-date' : 'revision-end-date'}>
                      <FormLabel
                        id={name === 'startAt' ? 'revision-start-label' : 'revision-end-label'}
                      >
                        {t(
                          name === 'startAt'
                            ? 'electricity.advanced.start'
                            : 'electricity.advanced.end',
                          locale
                        )}
                      </FormLabel>
                      <FormControl>
                        <RevisionDateControl
                          locale={locale}
                          timezone="Asia/Tehran"
                          disabled={locked}
                          value={
                            parseJalaliDateTime(field.value)
                              ? new Date(parseJalaliDateTime(field.value)!)
                              : undefined
                          }
                          onChange={(date) =>
                            field.onChange(date ? formatJalaliDateTime(date) : '')
                          }
                          onBlur={field.onBlur}
                          triggerProps={{
                            ref: field.ref,
                            'aria-labelledby':
                              name === 'startAt' ? 'revision-start-label' : 'revision-end-label',
                          }}
                        />
                      </FormControl>
                      {message(name)}
                    </FormItem>
                  )}
                />
              ))}
              <div className="grid gap-3 sm:grid-cols-2">
                {systemKeys.map((key) =>
                  key === 'green' && mandatoryGreen ? (
                    <div key={key}>
                      <p className="text-sm">{t('electricity.advanced.greenDerived', locale)}</p>
                    </div>
                  ) : (
                    text(
                      systemFields[key],
                      `${order.lines?.find((line) => line.systemKey === key)?.title?.[locale] ?? t(`electricity.order.revision.${key}`, locale)} (kWh)`,
                      `revision-${key.replace('_', '-')}`,
                      19,
                      true
                    )
                  )
                )}
              </div>
            </>
          ) : (
            <>
              <FormField
                control={form.control}
                name="period"
                render={({ field }) => (
                  <FormItem id="revision-period">
                    <FormLabel>{t('electricity.order.period.selection', locale)}</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className="w-full rounded-md border bg-background p-2"
                        disabled={locked || !periods.length}
                      >
                        {periods.map((option) => (
                          <option key={option.key} value={option.key}>
                            {t(periodLabels[option.key], locale)}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    {message('period')}
                  </FormItem>
                )}
              />
              {text(
                'totalKwh',
                `${t('electricity.order.quantity', locale)} (kWh)`,
                'revision-quantity',
                19,
                true
              )}
            </>
          )}
          {text('giftCode', t('electricity.order.giftCode', locale), 'revision-gift', 100)}
          {text(
            'fullAddress',
            t('electricity.order.deliveryAddress', locale),
            'revision-address',
            500
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="provinceId"
              render={({ field }) => (
                <FormItem id="revision-province">
                  <FormLabel>{t('electricity.order.revision.province', locale)}</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      className="w-full rounded-md border bg-background p-2"
                      disabled={locked || !provinceOptions.ready}
                      onChange={(event) => {
                        field.onChange(event);
                        form.setValue('cityId', '', {
                          shouldValidate: !!form.formState.touchedFields.cityId,
                        });
                      }}
                    >
                      <option value="">
                        {t('settings.addresses.form.provincePlaceholder', locale)}
                      </option>
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
                  </FormControl>
                  {message('provinceId')}
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="cityId"
              render={({ field }) => (
                <FormItem id="revision-city">
                  <FormLabel>{t('electricity.order.revision.city', locale)}</FormLabel>
                  <FormControl>
                    <DependentSelect
                      {...field}
                      className="w-full rounded-md border bg-background p-2"
                      disabled={locked}
                      dependencyValue={provinceId}
                      ready={cityOptions.ready}
                      loading={cityOptions.loading}
                      placeholder={t('electricity.order.revision.selectCity', locale)}
                      options={cities.map((city) => ({
                        value: city.id,
                        label: locale === 'fa' ? city.nameFa : city.nameEn,
                        dependencyValue: city.provinceId ?? '',
                      }))}
                      savedOption={{
                        value: order.cityId,
                        label: t('electricity.order.revision.currentCity', locale),
                        dependencyValue: order.provinceId,
                      }}
                    />
                  </FormControl>
                  {message('cityId')}
                </FormItem>
              )}
            />
          </div>
          <GeographyLoadError
            {...provinceOptions}
            message={t('settings.addresses.error.loadProvinces', locale)}
            locale={locale}
            testId="electricity-revision-province-retry"
          />
          <GeographyLoadError
            {...cityOptions}
            message={t('settings.addresses.error.loadCities', locale)}
            locale={locale}
            testId="electricity-revision-city-retry"
          />
          {text(
            'postalCode',
            t('electricity.order.correction.postalCode', locale),
            'revision-postal',
            10,
            true
          )}
          {text(
            'responseNote',
            t('electricity.order.correction.responseNote', locale),
            'revision-note',
            1000,
            false,
            true
          )}
          {error || form.formState.errors.root ? (
            <p role="alert" className="text-sm text-destructive">
              {unconfirmed
                ? copy('uncertain')
                : (form.formState.errors.root?.validation?.message ??
                  t('electricity.order.revision.error', locale))}
            </p>
          ) : null}
          {lock.owner === 'address' ? <p role="status">{copy('busy')}</p> : null}
          <Button
            type="submit"
            variant="outline"
            loading={busy}
            disabled={
              busy || locked || !optionsReady || !locationValid || (!advanced && !periods.length)
            }
          >
            {t('electricity.order.revision.preview', locale)}
          </Button>
          {unconfirmed ? (
            <Button
              type="button"
              data-testid="electricity-revision-retry"
              variant="outline"
              disabled={busy}
              onClick={() => void retry()}
            >
              {copy('retry')}
            </Button>
          ) : null}
        </form>
      </Form>
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
          <OrderWalletBalance
            profileId={order.profileId}
            total={currentReview.totalIrR}
            scopeKey={JSON.stringify([scopeKey, currentReview.reviewDigest])}
          />
          <p className="text-sm text-muted-foreground">
            {t('electricity.order.revision.replacesInvoice', locale)}
          </p>
          <Button type="button" disabled={busy || locked} onClick={() => void resubmit()}>
            {t('electricity.order.correction.submit', locale)}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
