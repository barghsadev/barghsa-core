import type { ProductCatalogueType } from '../lib/catalogue-category-query.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Button,
  DatePicker,
  datePickerAtTime,
  Input,
  Label,
  ListPage,
  Textarea,
} from '@barghsa/ui';
import { tCatalogue } from '@barghsa/i18n/catalogue';
import { useTimezone } from '../hooks/useTimezone.js';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { SavingAgreementEditor } from './SavingAgreementEditor.js';
import { SavingInventoryPanel } from '../components/SavingInventoryPanel.js';
const types = ['consultation', 'electricity', 'hardware', 'saving_plan'] as const;
type ProductType = (typeof types)[number];
type Product = {
  id: string;
  type: ProductType;
  systemKey: string | null;
  title: { fa: string; en: string };
  description: { fa: string; en: string } | null;
  price: string | null;
  status: 'active' | 'inactive' | 'archived';
  categories: string[];
  electricityLimits: { minKwh: string; maxKwh: string } | null;
};
type Detail = Product & {
  priceHistory: {
    id: string;
    price: string;
    effectiveFrom: string;
    effectiveUntil: string | null;
  }[];
  electricityLimitHistory: {
    id: string;
    minKwh: string;
    maxKwh: string;
    effectiveFrom: string;
    effectiveUntil: string | null;
  }[];
};
type References = { greenModes: string[]; vatOverride: boolean };
type Draft = {
  titleFa: string;
  titleEn: string;
  descriptionFa: string;
  descriptionEn: string;
  price: string;
  categories: string[];
  hardwareIds: string[];
  configureLimits: boolean;
  minKwh: string;
  maxKwh: string;
};
const categoryOptions: Record<ProductType, string[]> = {
  consultation: [
    'electricity_generation_station_consultation',
    'electricity_saving_certificate_consultation',
  ],
  electricity: [
    'thermal_electricity',
    'green_electricity',
    'free_market_electricity',
    'energy_saving_electricity',
  ],
  hardware: [],
  saving_plan: [],
};
const base = '/api/admin/catalogue/products';
export default function AdminCataloguePage({
  initialType = 'consultation',
  onTypeChange,
  focusCategory = false,
}: {
  initialType?: ProductCatalogueType;
  focusCategory?: boolean;
  onTypeChange?: (value: ProductCatalogueType) => void;
} = {}) {
  const preference = useTimezone();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => tCatalogue(key, locale);
  const [type, setType] = useState<ProductType>(initialType),
    [rows, setRows] = useState<Product[]>([]);
  const [hardwareOptions, setHardwareOptions] = useState<Product[]>([]);
  const [preventActiveDuplicates, setPreventActiveDuplicates] = useState(true);
  const [editor, setEditor] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [draft, setDraft] = useState<Draft | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading'),
    [revision, setRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [hardwareRevision, setHardwareRevision] = useState(0);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('ready');
  const [hardwareState, setHardwareState] = useState<'loading' | 'ready' | 'error'>('ready');
  const accessDenied = useRef(false);
  const hasEditor = editor !== null;
  const [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false),
    [references, setReferences] = useState<References | null>(null);
  const [priceOpen, setPriceOpen] = useState(false),
    [price, setPrice] = useState(''),
    [scheduled, setScheduled] = useState(false),
    [date, setDate] = useState<Date | undefined>(),
    [time, setTime] = useState('00:00'),
    [invalidDate, setInvalidDate] = useState(false);
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  function switchType(value: ProductType) {
    if (value === type) return;
    if (onTypeChange) {
      onTypeChange(value);
      return;
    }
    setState('loading');
    setRows([]);
    choose(null);
    setType(value);
  }
  const zone = preference.timezone;
  const title = (row: Product) => row.title[locale] || row.title.en || row.title.fa;
  const money = (value: string | null) => (value === null ? label('unset') : numbers.money(value));
  const dateText = (value: string) => new Date(value).toLocaleString(locale, { timeZone: zone });
  function denyAccess() {
    accessDenied.current = true;
    setState('denied');
    setRows([]);
    setHardwareOptions([]);
    setEditor(null);
    setDraft(null);
    setDetail(null);
    setReferences(null);
    setPriceOpen(false);
    setAction(null);
  }
  useEffect(() => {
    const abort = new AbortController();
    accessDenied.current = false;
    setState('loading');
    void fetch(`${base}?type=${type}`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<Product[]>;
      })
      .then((products) => {
        if (abort.signal.aborted || accessDenied.current) return;
        setRows(products);
        setState('ready');
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted || accessDenied.current) return;
        if (cause instanceof Error && cause.message === '403') denyAccess();
        else setState('error');
      });
    return () => abort.abort();
  }, [type, revision, listRevision]);
  useEffect(() => {
    const abort = new AbortController();
    setHardwareOptions([]);
    if (type !== 'saving_plan' || !hasEditor || accessDenied.current) {
      setHardwareState('ready');
      return;
    }
    setHardwareState('loading');
    void fetch(`${base}?type=hardware`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<Product[]>;
      })
      .then((products) => {
        if (abort.signal.aborted || accessDenied.current) return;
        setHardwareOptions(products);
        setHardwareState('ready');
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted || accessDenied.current) return;
        if (cause instanceof Error && cause.message === '403') denyAccess();
        else setHardwareState('error');
      });
    return () => abort.abort();
  }, [type, hasEditor, revision, hardwareRevision]);
  useEffect(() => {
    const abort = new AbortController();
    setDraft(null);
    setDetail(null);
    setReferences(null);
    setPriceOpen(false);
    setInvalidDate(false);
    if (!editor || accessDenied.current) {
      setDetailState('ready');
      return;
    }
    function populate(
      product: Detail | null,
      config?: {
        hardwareIds: string[];
        preventActiveDuplicates: boolean;
      }
    ) {
      setDetail(product);
      setPreventActiveDuplicates(config?.preventActiveDuplicates ?? true);
      setDraft({
        titleFa: product?.title.fa ?? '',
        titleEn: product?.title.en ?? '',
        descriptionFa: product?.description?.fa ?? '',
        descriptionEn: product?.description?.en ?? '',
        price: '',
        categories: product?.categories ?? [],
        hardwareIds: config?.hardwareIds ?? [],
        configureLimits: !!product?.electricityLimits,
        minKwh: product?.electricityLimits?.minKwh ?? '0',
        maxKwh: product?.electricityLimits?.maxKwh ?? '0',
      });
      setDetailState('ready');
    }
    if (editor === 'new') {
      populate(null);
      return;
    }
    setDetailState('loading');
    void (async () => {
      try {
        const paths = [
          `${base}/${editor}`,
          `${base}/${editor}/rule-references`,
          ...(type === 'saving_plan'
            ? [`/api/admin/catalogue/saving-plans/${editor}/configuration`]
            : []),
        ];
        const responses = await Promise.all(
          paths.map((path) => fetch(path, { signal: abort.signal }))
        );
        if (responses.some((response) => response.status === 403)) {
          if (!abort.signal.aborted) denyAccess();
          return;
        }
        if (responses.some((response) => !response.ok)) throw new Error('Load failed');
        const data = await Promise.all(responses.map((response) => response.json()));
        if (abort.signal.aborted || accessDenied.current) return;
        setReferences(data[1] as References);
        populate(data[0] as Detail, data[2]);
      } catch {
        if (!abort.signal.aborted && !accessDenied.current) setDetailState('error');
      }
    })();
    return () => abort.abort();
  }, [type, editor, revision, detailRevision]);
  function choose(value: string | null) {
    setAction(null);
    setDraft(null);
    setDetail(null);
    setReferences(null);
    setPriceOpen(false);
    setInvalidDate(false);
    setEditor(value);
    setDetailRevision((value) => value + 1);
  }
  function refresh() {
    if (preference.status === 'error') preference.retry();
    setAction(null);
    setRevision((value) => value + 1);
  }
  function propose(
    path: string,
    method: TeamAction['method'],
    heading: string,
    description: string,
    body?: unknown
  ) {
    setSaved(false);
    setAction({
      path,
      method,
      title: heading,
      description,
      ...(body === undefined ? {} : { body }),
      forbiddenMessage: label('denied'),
      conflictMessage: label('conflict'),
      errorMessages: {
        'VALIDATION:PARSE:ZOD_ERROR': label('invalid'),
        CATALOGUE_CATEGORIES_NOT_ALLOWED: label('invalid'),
        CATALOGUE_CATEGORY_INVALID: label('invalid'),
        CATALOGUE_LIMITS_INVALID: label('invalid'),
        CATALOGUE_LIMITS_NOT_ALLOWED: label('invalid'),
        CATALOGUE_SYSTEM_PRODUCT_IMMUTABLE: label('system'),
        CATALOGUE_PRICE_INVALID_EFFECTIVE_FROM: label('invalidWindow'),
        CATALOGUE_PRICE_OVERLAP: label('conflict'),
        CATALOGUE_PRODUCT_NOT_FOUND: label('conflict'),
      },
    });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !editor) return;
    const body = {
      title: { fa: draft.titleFa.trim(), en: draft.titleEn.trim() },
      description: { fa: draft.descriptionFa, en: draft.descriptionEn },
      categories: draft.categories,
      ...(type === 'saving_plan' ? { hardwareIds: draft.hardwareIds } : {}),
      ...(editor === 'new'
        ? { type, price: draft.price || null, status: 'inactive' }
        : type === 'electricity' && draft.configureLimits
          ? { minKwh: draft.minKwh, maxKwh: draft.maxKwh }
          : {}),
    };
    propose(
      `${base}${editor === 'new' ? '' : `/${editor}`}`,
      editor === 'new' ? 'POST' : 'PUT',
      label('save'),
      label('confirmSave'),
      body
    );
  }
  function savePrice(event: FormEvent) {
    event.preventDefault();
    if (!detail || preference.status !== 'ready') return;
    let effectiveFrom: string | undefined;
    if (scheduled) {
      const match = /^(\d{2}):(\d{2})$/.exec(time);
      if (!date || !match) {
        setInvalidDate(true);
        return;
      }
      const value = datePickerAtTime(date, Number(match[1]), Number(match[2]), zone);
      if (!value) {
        setInvalidDate(true);
        return;
      }
      effectiveFrom = value.toISOString();
    }
    setInvalidDate(false);
    propose(`${base}/${detail.id}/prices`, 'POST', label('savePrice'), label('confirmPrice'), {
      price,
      ...(effectiveFrom ? { effectiveFrom } : {}),
    });
  }
  const referenceNames = [
    ...(references?.greenModes ?? []).map(label),
    ...(references?.vatOverride ? [label('vatOverride')] : []),
  ];
  const warning = referenceNames.length
    ? `${label('references')} ${referenceNames.join(' · ')}`
    : '';
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      {saved && <p role="status">{label('saved')}</p>}
      <div>
        <div className="max-w-full overflow-x-auto pb-2">
          <div role="tablist" aria-label={label('title')} className="flex w-max gap-2">
            {types.map((value, index) => (
              <Button
                key={value}
                autoFocus={focusCategory && type === value}
                role="tab"
                id={`catalogue-tab-${value}`}
                aria-controls={`catalogue-panel-${value}`}
                aria-selected={type === value}
                tabIndex={type === value ? 0 : -1}
                variant={type === value ? 'default' : 'outline'}
                ref={(element) => {
                  tabButtons.current[index] = element;
                }}
                onClick={() => switchType(value)}
                onKeyDown={(event) => {
                  const forward = locale === 'fa' ? 'ArrowLeft' : 'ArrowRight';
                  const backward = locale === 'fa' ? 'ArrowRight' : 'ArrowLeft';
                  const next =
                    event.key === forward
                      ? (index + 1) % types.length
                      : event.key === backward
                        ? (index + types.length - 1) % types.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? types.length - 1
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  switchType(types[next]!);
                  tabButtons.current[next]?.focus();
                }}
              >
                {label(value)}
              </Button>
            ))}
          </div>
        </div>
        {types
          .filter((value) => value === type)
          .map((value) => (
            <div
              key={value}
              role="tabpanel"
              id={`catalogue-panel-${value}`}
              aria-labelledby={`catalogue-tab-${value}`}
              tabIndex={0}
              className="flex flex-col gap-5"
            >
              <ListPage>
                <ListPage.Toolbar
                  actions={
                    <>
                      <Button variant="outline" onClick={refresh}>
                        {label('refresh')}
                      </Button>
                      {type !== 'electricity' && state !== 'denied' && (
                        <Button onClick={() => choose('new')}>{label('add')}</Button>
                      )}
                    </>
                  }
                />
                {preference.status === 'loading' && <p role="status">{label('loading')}</p>}
                {preference.status === 'error' && (
                  <div role="alert" className="space-y-2">
                    <p>{label('timezoneError')}</p>
                    <Button variant="outline" onClick={preference.retry}>
                      {label('retry')}
                    </Button>
                  </div>
                )}
                {editor && detailState === 'loading' && <p role="status">{label('loading')}</p>}
                {editor && detailState === 'error' && (
                  <div role="alert" className="space-y-2">
                    <p>{label('detailError')}</p>
                    <Button variant="outline" onClick={() => setDetailRevision((v) => v + 1)}>
                      {label('retry')}
                    </Button>
                  </div>
                )}
                {draft && (
                  <>
                    <form
                      aria-label={label('editor')}
                      onSubmit={save}
                      className="flex flex-col gap-4 border-y py-5"
                    >
                      {detail && (
                        <h2 className="break-words text-xl font-semibold">{title(detail)}</h2>
                      )}
                      {detail?.systemKey && <p role="note">{label('system')}</p>}
                      {(['titleFa', 'titleEn'] as const).map((field) => (
                        <div key={field}>
                          <Label htmlFor={`catalogue-${field}`}>{label(field)}</Label>
                          <Input
                            id={`catalogue-${field}`}
                            dir={field === 'titleFa' ? 'rtl' : 'ltr'}
                            required
                            maxLength={300}
                            value={draft[field]}
                            onChange={(event) =>
                              setDraft({ ...draft, [field]: event.target.value })
                            }
                          />
                        </div>
                      ))}
                      {(['descriptionFa', 'descriptionEn'] as const).map((field) => (
                        <div key={field}>
                          <Label htmlFor={`catalogue-${field}`}>{label(field)}</Label>
                          <Textarea
                            id={`catalogue-${field}`}
                            dir={field === 'descriptionFa' ? 'rtl' : 'ltr'}
                            maxLength={4000}
                            value={draft[field]}
                            onChange={(event) =>
                              setDraft({ ...draft, [field]: event.target.value })
                            }
                          />
                        </div>
                      ))}
                      {editor === 'new' && (
                        <div>
                          <Label htmlFor="catalogue-initial-price">{label('initialPrice')}</Label>
                          <Input
                            id="catalogue-initial-price"
                            inputMode="numeric"
                            pattern="[0-9]{1,18}"
                            maxLength={18}
                            value={draft.price}
                            onChange={(event) => setDraft({ ...draft, price: event.target.value })}
                          />
                          <p className="mt-2 text-sm">
                            {label('status')}: {label('inactive')}
                          </p>
                        </div>
                      )}
                      {!!categoryOptions[type].length && (
                        <fieldset className="rounded-md border p-4">
                          <legend className="px-1 font-semibold">{label('categories')}</legend>
                          <div className="flex flex-col gap-3">
                            {categoryOptions[type].map((category) => (
                              <label key={category} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={draft.categories.includes(category)}
                                  onChange={(event) =>
                                    setDraft({
                                      ...draft,
                                      categories: event.target.checked
                                        ? [...draft.categories, category]
                                        : draft.categories.filter((value) => value !== category),
                                    })
                                  }
                                />
                                {label(category)}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      )}
                      {type === 'saving_plan' && (
                        <fieldset className="rounded-md border p-4">
                          <legend className="px-1 font-semibold">{label('planHardware')}</legend>
                          <p className="mb-3 text-sm text-muted-foreground">
                            {label('planHardwareHelp')}
                          </p>
                          {hardwareState === 'loading' && <p role="status">{label('loading')}</p>}
                          {hardwareState === 'error' && (
                            <div role="alert" className="space-y-2">
                              <p>{label('hardwareError')}</p>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setHardwareRevision((v) => v + 1)}
                              >
                                {label('retry')}
                              </Button>
                            </div>
                          )}
                          <div className="flex flex-col gap-3">
                            {hardwareOptions
                              .filter((item) => item.status !== 'archived')
                              .map((item) => (
                                <label key={item.id} className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={draft.hardwareIds.includes(item.id)}
                                    onChange={(event) =>
                                      setDraft({
                                        ...draft,
                                        hardwareIds: event.target.checked
                                          ? [...draft.hardwareIds, item.id]
                                          : draft.hardwareIds.filter((id) => id !== item.id),
                                      })
                                    }
                                  />
                                  {title(item)} · {money(item.price)}
                                </label>
                              ))}
                          </div>
                        </fieldset>
                      )}
                      {type === 'electricity' && (
                        <fieldset className="rounded-md border p-4">
                          <legend className="px-1 font-semibold">{label('limits')}</legend>
                          {!detail?.electricityLimits && (
                            <label className="mb-3 flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={draft.configureLimits}
                                onChange={(event) =>
                                  setDraft({ ...draft, configureLimits: event.target.checked })
                                }
                              />
                              {label('configureLimits')}
                            </label>
                          )}
                          {draft.configureLimits && (
                            <>
                              <p className="mb-3 text-sm">{label('limitsHelp')}</p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                {(['minKwh', 'maxKwh'] as const).map((field) => (
                                  <div key={field}>
                                    <Label htmlFor={`catalogue-${field}`}>{label(field)}</Label>
                                    <Input
                                      id={`catalogue-${field}`}
                                      required
                                      inputMode="numeric"
                                      pattern="[0-9]{1,18}"
                                      maxLength={18}
                                      value={draft[field]}
                                      onChange={(event) =>
                                        setDraft({ ...draft, [field]: event.target.value })
                                      }
                                    />
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </fieldset>
                      )}
                      <div className="flex gap-2">
                        <Button
                          type="submit"
                          disabled={
                            !draft.titleFa.trim() ||
                            !draft.titleEn.trim() ||
                            (type === 'saving_plan' &&
                              (hardwareState !== 'ready' || draft.hardwareIds.length === 0))
                          }
                        >
                          {label('save')}
                        </Button>
                        <Button type="button" variant="outline" onClick={() => choose(null)}>
                          {label('cancel')}
                        </Button>
                      </div>
                    </form>
                    {detail && (
                      <section className="flex flex-col gap-4" aria-label={label('status')}>
                        <p>
                          {label('status')}: {label(detail.status)}
                        </p>
                        {warning && (
                          <p role="note" className="rounded-md border p-3">
                            {warning}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            onClick={() =>
                              propose(
                                `${base}/${detail.id}`,
                                'PUT',
                                label(
                                  detail.status === 'active'
                                    ? 'deactivate'
                                    : detail.status === 'archived'
                                      ? 'restore'
                                      : 'activate'
                                ),
                                `${label('confirmStatus')} ${detail.status === 'active' ? warning : ''}`,
                                { status: detail.status === 'inactive' ? 'active' : 'inactive' }
                              )
                            }
                          >
                            {label(
                              detail.status === 'active'
                                ? 'deactivate'
                                : detail.status === 'archived'
                                  ? 'restore'
                                  : 'activate'
                            )}
                          </Button>
                          {!detail.systemKey && detail.status !== 'archived' && (
                            <Button
                              variant="outline"
                              onClick={() =>
                                propose(
                                  `${base}/${detail.id}`,
                                  'DELETE',
                                  label('archive'),
                                  `${label('confirmArchive')} ${warning}`
                                )
                              }
                            >
                              {label('archive')}
                            </Button>
                          )}
                        </div>
                      </section>
                    )}
                    {detail && type === 'saving_plan' && (
                      <section
                        className="rounded-md border p-4"
                        aria-label={label('duplicatePolicy')}
                      >
                        <h2 className="font-semibold">{label('duplicatePolicy')}</h2>
                        <p className="my-2 text-sm text-muted-foreground">
                          {label('duplicatePolicyHelp')}
                        </p>
                        <p className="mb-3 text-sm">
                          {label(
                            preventActiveDuplicates ? 'duplicatesBlocked' : 'duplicatesAllowed'
                          )}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            propose(
                              `/api/admin/catalogue/saving-plans/${detail.id}/duplicate-policy`,
                              'PUT',
                              label('duplicatePolicy'),
                              label('confirmDuplicatePolicy'),
                              { preventActiveDuplicates: !preventActiveDuplicates }
                            )
                          }
                        >
                          {label(preventActiveDuplicates ? 'allowDuplicates' : 'blockDuplicates')}
                        </Button>
                      </section>
                    )}
                    {detail && type === 'saving_plan' && (
                      <SavingAgreementEditor
                        planId={detail.id}
                        onChanged={() => choose(detail.id)}
                      />
                    )}
                    {detail && type === 'hardware' && (
                      <SavingInventoryPanel hardwareId={detail.id} />
                    )}
                    {detail && preference.status === 'ready' && (
                      <section
                        aria-label={label('history')}
                        className="flex flex-col gap-3 border-y py-5"
                      >
                        <h2 className="text-xl font-semibold">{label('history')}</h2>
                        <p>
                          {label('price')}: {money(detail.price)}
                        </p>
                        <p className="text-sm">
                          {label('timezone')}: <bdi>{zone}</bdi>
                        </p>
                        {!priceOpen && (
                          <div>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setPriceOpen(true);
                                setPrice('');
                                setScheduled(false);
                                setDate(undefined);
                                setTime('00:00');
                                setInvalidDate(false);
                              }}
                            >
                              {label('addPrice')}
                            </Button>
                          </div>
                        )}
                        {priceOpen && (
                          <form
                            aria-label={label('priceEditor')}
                            onSubmit={savePrice}
                            className="flex flex-col gap-4"
                          >
                            <div>
                              <Label htmlFor="catalogue-price">{label('price')}</Label>
                              <Input
                                id="catalogue-price"
                                required
                                inputMode="numeric"
                                pattern="[0-9]{1,18}"
                                maxLength={18}
                                value={price}
                                onChange={(event) => setPrice(event.target.value)}
                              />
                            </div>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={scheduled}
                                onChange={(event) => setScheduled(event.target.checked)}
                              />
                              {label('schedule')}
                            </label>
                            <p className="text-sm">{label('immediate')}</p>
                            {scheduled && (
                              <div className="grid gap-4 sm:grid-cols-2">
                                <DatePicker
                                  label={label('date')}
                                  placeholder={label('chooseDate')}
                                  locale={locale}
                                  timezone={zone}
                                  {...(date ? { value: date } : {})}
                                  onChange={setDate}
                                />
                                <div>
                                  <Label htmlFor="catalogue-time">{label('time')}</Label>
                                  <Input
                                    id="catalogue-time"
                                    type="time"
                                    required
                                    value={time}
                                    onChange={(event) => setTime(event.target.value)}
                                  />
                                </div>
                              </div>
                            )}
                            {invalidDate && <p role="alert">{label('invalidDate')}</p>}
                            <div className="flex gap-2">
                              <Button type="submit" disabled={scheduled && !date}>
                                {label('savePrice')}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setPriceOpen(false)}
                              >
                                {label('cancel')}
                              </Button>
                            </div>
                          </form>
                        )}
                        {!detail.priceHistory.length && <p>{label('noHistory')}</p>}
                        <ol className="divide-y">
                          {detail.priceHistory.map((version) => (
                            <li key={version.id} className="flex flex-col gap-2 py-3">
                              <p className="font-semibold">
                                {money(version.price)} ·{' '}
                                {label(
                                  Date.parse(version.effectiveFrom) > Date.now()
                                    ? 'scheduled'
                                    : version.effectiveUntil &&
                                        Date.parse(version.effectiveUntil) <= Date.now()
                                      ? 'ended'
                                      : 'current'
                                )}
                              </p>
                              <p>
                                {label('from')}: {dateText(version.effectiveFrom)}
                              </p>
                              {version.effectiveUntil && (
                                <p>
                                  {label('until')}: {dateText(version.effectiveUntil)}
                                </p>
                              )}
                            </li>
                          ))}
                        </ol>
                        {detail.type === 'electricity' && (
                          <div className="space-y-2 border-t pt-4">
                            <h3 className="font-semibold">{label('limitHistory')}</h3>
                            {!detail.electricityLimitHistory.length && (
                              <p>{label('noLimitHistory')}</p>
                            )}
                            <ol className="divide-y">
                              {detail.electricityLimitHistory.map((version) => (
                                <li key={version.id} className="space-y-1 py-3">
                                  <p>
                                    {label('minKwh')}: {version.minKwh} · {label('maxKwh')}:{' '}
                                    {version.maxKwh}
                                  </p>
                                  <p>
                                    {label('from')}: {dateText(version.effectiveFrom)}
                                  </p>
                                  {version.effectiveUntil && (
                                    <p>
                                      {label('until')}: {dateText(version.effectiveUntil)}
                                    </p>
                                  )}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </section>
                    )}
                  </>
                )}
                <ListPage.Content
                  loading={state === 'loading'}
                  error={state === 'error' || state === 'denied'}
                  empty={!rows.length}
                  retainContent={!!rows.length && state !== 'denied'}
                  loadingView={<p role="status">{label('loading')}</p>}
                  errorView={
                    state === 'denied' ? (
                      <p role="alert">{label('denied')}</p>
                    ) : (
                      <div className="space-y-2">
                        <p role="alert">{label('error')}</p>
                        <Button variant="outline" onClick={() => setListRevision((v) => v + 1)}>
                          {label('retry')}
                        </Button>
                      </div>
                    )
                  }
                  emptyView={<p>{label('empty')}</p>}
                >
                  <ul className="divide-y">
                    {rows.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-start justify-between gap-3 py-4"
                      >
                        <div className="min-w-0">
                          <h2 className="break-words font-semibold">{title(row)}</h2>
                          <p>
                            {label(row.status)} · {money(row.price)}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          aria-label={`${label('edit')} ${title(row)}`}
                          onClick={() => choose(row.id)}
                        >
                          {label('edit')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </ListPage.Content>
              </ListPage>
            </div>
          ))}
      </div>
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setSaved(true);
            choose(action.path.endsWith('/duplicate-policy') ? editor : null);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
