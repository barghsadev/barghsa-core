import type { ProductCatalogueType } from '../lib/catalogue-category-query.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
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
import {
  types,
  categoryOptions,
  productDefaults,
  priceDefaults,
  catalogueInteger,
  validProducts,
  validDetail,
  validReferences,
  validConfig,
  productBasis,
  detailBasis,
  matchesProductReceipt,
  matchesPriceReceipt,
  record,
  type ProductType,
  type Product,
  type Detail,
  type References,
  type Draft,
  type PriceDraft,
} from '../lib/catalogue-form.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
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
    [detail, setDetail] = useState<Detail | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading'),
    [revision, setRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [hardwareRevision, setHardwareRevision] = useState(0);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('ready');
  const [hardwareState, setHardwareState] = useState<'loading' | 'ready' | 'error'>('ready');
  const productContext = useRef({
    type,
    isNew: true,
    categories: categoryOptions[type],
    hardwareIds: [] as string[],
  });
  const productMessages: Record<keyof Draft, string> = {
    titleFa: label('invalidTitleFa'),
    titleEn: label('invalidTitleEn'),
    descriptionFa: label('invalidDescription'),
    descriptionEn: label('invalidDescription'),
    price: label('invalidPrice'),
    categories: label('invalidCategories'),
    hardwareIds: label('invalidHardware'),
    configureLimits: label('invalidLimits'),
    minKwh: label('invalidLimits'),
    maxKwh: label('invalidLimits'),
  };
  const priceMessages: Record<keyof PriceDraft, string> = {
    price: label('invalidPrice'),
    scheduled: label('invalidDate'),
    date: label('invalidDate'),
    time: label('invalidTime'),
  };
  const productForm = useWizardForm<Draft>(
    async () => {
      const context = productContext.current;
      const { productFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return productFormSchema(context, productMessages, catalogueInteger);
    },
    productDefaults,
    label('validationUnavailable')
  );
  const priceForm = useWizardForm<PriceDraft>(
    async () => {
      const zone = preference.timezone;
      const { priceFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return priceFormSchema(priceMessages, catalogueInteger, (value) => priceInstant(value, zone));
    },
    priceDefaults,
    label('validationUnavailable')
  );
  const draft = hasDraft ? productForm.values : null;
  function setDraft(value: Draft | null) {
    if (!value) {
      productForm.form.reset(productDefaults);
      setHasDraft(false);
      return;
    }
    for (const field of Object.keys(value) as (keyof Draft)[])
      productForm.field(field)[1](value[field] as never);
    setHasDraft(true);
  }
  const productErrors = useActionFieldErrors(productForm.form, productMessages, label('invalid'));
  const priceErrors = useActionFieldErrors(priceForm.form, priceMessages, label('invalid'));
  const invalidFocus = useRef<{ kind: 'product' | 'price'; field: string } | null>(null);
  const pending =
    productForm.pending ||
    priceForm.pending ||
    productForm.form.formState.isSubmitting ||
    priceForm.form.formState.isSubmitting;
  useEffect(() => {
    if (pending || !invalidFocus.current) return;
    const target = invalidFocus.current;
    invalidFocus.current = null;
    if (!target.field) return;
    if (target.kind === 'product') productForm.form.setFocus(target.field as keyof Draft);
    else priceForm.form.setFocus(target.field as keyof PriceDraft);
  }, [pending, productForm.form, priceForm.form]);
  const { register } = productForm.form;
  const categoriesRef = useCallback(
    (element: HTMLElement | null) =>
      register('categories').ref(
        element ? { name: 'categories', focus: () => element.focus() } : null
      ),
    [register]
  );
  const hardwareRef = useCallback(
    (element: HTMLElement | null) =>
      register('hardwareIds').ref(
        element ? { name: 'hardwareIds', focus: () => element.focus() } : null
      ),
    [register]
  );
  function groupBinding(field: 'categories' | 'hardwareIds') {
    const binding = productForm.bind(field);
    return {
      ...binding,
      // Keep a stable focus proxy: registering the fieldset discovers its first checkbox's 'on'.
      ref: field === 'categories' ? categoriesRef : hardwareRef,
    };
  }
  function feedback(field: keyof Draft) {
    const message = productForm.errors[field]?.message;
    return (
      <p
        id={productForm.errorId(field)}
        role={message ? 'alert' : undefined}
        aria-hidden={message ? undefined : true}
        className={`text-sm text-destructive ${message ? '' : 'invisible'}`}
      >
        {typeof message === 'string' ? message : productMessages[field]}
      </p>
    );
  }
  function priceFeedback(field: keyof PriceDraft) {
    const message = priceForm.errors[field]?.message;
    return (
      <p
        id={priceForm.errorId(field)}
        role={message ? 'alert' : undefined}
        aria-hidden={message ? undefined : true}
        className={`text-sm text-destructive ${message ? '' : 'invisible'}`}
      >
        {typeof message === 'string' ? message : priceMessages[field]}
      </p>
    );
  }
  const generation = useRef(0),
    commandVersion = useRef(0),
    commandKind = useRef<'product' | 'price' | 'other'>('other');
  const source = useRef<{ scope: string; basis: string } | null>(null),
    acceptedReferences = useRef<References | null>(null);
  const [uncertainCreate, setUncertainCreate] = useState(false);
  const accessDenied = useRef(false);
  const hasEditor = editor !== null;
  const [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false),
    [references, setReferences] = useState<References | null>(null);
  const [priceOpen, setPriceOpen] = useState(false),
    [invalidDate, setInvalidDate] = useState(false);
  const [price, setPrice] = priceForm.field('price'),
    [scheduled, setScheduled] = priceForm.field('scheduled'),
    [date, setDate] = priceForm.field('date'),
    [time, setTime] = priceForm.field('time');
  productContext.current = {
    type,
    isNew: editor === 'new',
    categories: categoryOptions[type],
    hardwareIds: hardwareOptions.filter((row) => row.status !== 'archived').map((row) => row.id),
  };
  const [savingBusy, setSavingBusy] = useState(false);
  const blocked = pending || action !== null || savingBusy;
  const live = useRef({
    type,
    editor,
    detail,
    detailState,
    hardwareState,
    hardwareOptions,
    zone: preference.timezone,
    zoneState: preference.status,
  });
  live.current = {
    type,
    editor,
    detail,
    detailState,
    hardwareState,
    hardwareOptions,
    zone: preference.timezone,
    zoneState: preference.status,
  };
  const ready = () =>
    !accessDenied.current &&
    live.current.detailState === 'ready' &&
    (live.current.type !== 'saving_plan' || live.current.hardwareState === 'ready');
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  const acceptedZone = useRef<string | null>(null);
  useEffect(() => {
    if (preference.status !== 'ready') return;
    if (acceptedZone.current !== null && acceptedZone.current !== preference.timezone) {
      generation.current++;
      setAction(null);
      if (priceForm.form.getValues('scheduled')) {
        priceForm.form.setValue('date', undefined);
        priceForm.form.clearErrors(['date', 'time']);
        setInvalidDate(true);
      }
    }
    acceptedZone.current = preference.timezone;
  }, [preference.status, preference.timezone]);
  function priceInstant(value: PriceDraft, timezone: string): string | null {
    const match = /^(\d{2}):(\d{2})$/.exec(value.time);
    if (!value.date || !match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    return (
      datePickerAtTime(value.date, Number(match[1]), Number(match[2]), timezone)?.toISOString() ??
      null
    );
  }
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
    generation.current++;
    invalidFocus.current = null;
    source.current = null;
    acceptedReferences.current = null;
    priceForm.form.reset(priceDefaults);
    setUncertainCreate(false);
    setSaved(false);
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
        const data: unknown = await response.json();
        if (!validProducts(data, type)) throw new Error('Invalid catalogue');
        return data;
      })
      .then((products) => {
        if (abort.signal.aborted || accessDenied.current) return;
        setRows(products);
        setState('ready');
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted || accessDenied.current) return;
        if (cause instanceof Error && ['401', '403'].includes(cause.message)) denyAccess();
        else setState('error');
      });
    return () => abort.abort();
  }, [type, revision, listRevision]);
  useEffect(() => {
    const abort = new AbortController();
    if (type !== 'saving_plan' || !hasEditor || accessDenied.current) {
      setHardwareState('ready');
      return;
    }
    setHardwareState('loading');
    void fetch(`${base}?type=hardware`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const data: unknown = await response.json();
        if (!validProducts(data, 'hardware')) throw new Error('Invalid hardware');
        return data;
      })
      .then((products) => {
        if (abort.signal.aborted || accessDenied.current) return;
        setHardwareOptions(products);
        setHardwareState('ready');
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted || accessDenied.current) return;
        if (cause instanceof Error && ['401', '403'].includes(cause.message)) denyAccess();
        else setHardwareState('error');
      });
    return () => abort.abort();
  }, [type, hasEditor, revision, hardwareRevision]);
  useEffect(() => {
    const abort = new AbortController();
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
      const scopeKey = `${type}:${editor}`,
        nextBasis = detailBasis(product, product ? acceptedReferences.current : null, config);
      if (source.current?.scope !== scopeKey || source.current.basis !== nextBasis) {
        generation.current++;
        setAction(null);
        priceForm.form.reset(priceDefaults);
        setPriceOpen(false);
        setInvalidDate(false);
        productForm.form.reset({
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
        setHasDraft(true);
      }
      source.current = { scope: scopeKey, basis: nextBasis };
      setDetail(product);
      setPreventActiveDuplicates(config?.preventActiveDuplicates ?? true);
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
        if (responses.some((response) => response.status === 401 || response.status === 403)) {
          if (!abort.signal.aborted) denyAccess();
          return;
        }
        if (responses.some((response) => !response.ok)) throw new Error('Load failed');
        const data = await Promise.all(responses.map((response) => response.json()));
        if (abort.signal.aborted || accessDenied.current) return;
        if (
          !validDetail(data[0]) ||
          data[0].id !== editor ||
          data[0].type !== type ||
          !validReferences(data[1]) ||
          (type === 'saving_plan' && !validConfig(data[2]))
        )
          throw new Error('Invalid catalogue detail');
        acceptedReferences.current = data[1];
        setReferences(data[1]);
        populate(data[0], data[2]);
      } catch {
        if (!abort.signal.aborted && !accessDenied.current) setDetailState('error');
      }
    })();
    return () => abort.abort();
  }, [type, editor, revision, detailRevision]);
  useEffect(() => {
    const current = live.current;
    if (
      !current.editor ||
      current.editor === 'new' ||
      !current.detail ||
      accessDenied.current ||
      state !== 'ready'
    )
      return;
    const row = rows.find((value) => value.id === current.editor);
    if (!row) {
      choose(null);
      return;
    }
    if (JSON.stringify(productBasis(row)) !== JSON.stringify(productBasis(current.detail))) {
      generation.current++;
      setAction(null);
      setDetailRevision((value) => value + 1);
    }
  }, [rows]);
  useEffect(() => {
    if (hardwareState !== 'ready' || !action || !record(action.body)) return;
    const selected = action.body.hardwareIds;
    if (
      Array.isArray(selected) &&
      selected.some(
        (id) => !hardwareOptions.some((item) => item.id === id && item.status !== 'archived')
      )
    ) {
      generation.current++;
      setAction(null);
    }
  }, [hardwareOptions, hardwareState, action]);
  function choose(value: string | null) {
    generation.current++;
    invalidFocus.current = null;
    source.current = null;
    acceptedReferences.current = null;
    setSaved(false);
    setUncertainCreate(false);
    priceForm.form.reset(priceDefaults);
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
    setRevision((value) => value + 1);
  }
  function propose(
    path: string,
    method: TeamAction['method'],
    heading: string,
    description: string,
    body?: unknown
  ) {
    if (accessDenied.current || action || uncertainCreate || savingBusy) return;
    commandVersion.current = generation.current;
    if (heading !== label('save') && heading !== label('savePrice')) commandKind.current = 'other';
    setSaved(false);
    setAction({
      path,
      method,
      ...(method === 'DELETE' ? { successStatus: 204 } : {}),
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
  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      !draft ||
      !editor ||
      !ready() ||
      productForm.isPending() ||
      priceForm.isPending() ||
      savingBusy ||
      action ||
      uncertainCreate
    )
      return;
    const version = generation.current,
      basis = source.current?.basis,
      options = JSON.stringify([...productContext.current.hardwareIds].sort());
    productForm.setValidationPending(true);
    try {
      await productForm.form.handleSubmit(
        async (values) => {
          if (
            version !== generation.current ||
            basis !== source.current?.basis ||
            !ready() ||
            JSON.stringify(
              live.current.hardwareOptions
                .filter((row) => row.status !== 'archived')
                .map((row) => row.id)
                .sort()
            ) !== options
          )
            return;
          const body = {
            title: { fa: values.titleFa.trim(), en: values.titleEn.trim() },
            description: { fa: values.descriptionFa, en: values.descriptionEn },
            categories: values.categories,
            ...(type === 'saving_plan' ? { hardwareIds: values.hardwareIds } : {}),
            ...(editor === 'new'
              ? {
                  type,
                  price: values.price.trim() ? catalogueInteger(values.price) : null,
                  status: 'inactive',
                }
              : type === 'electricity' && values.configureLimits
                ? {
                    minKwh: catalogueInteger(values.minKwh),
                    maxKwh: catalogueInteger(values.maxKwh),
                  }
                : {}),
          };
          commandKind.current = 'product';
          propose(
            `${base}${editor === 'new' ? '' : `/${editor}`}`,
            editor === 'new' ? 'POST' : 'PUT',
            label('save'),
            label('confirmSave'),
            body
          );
        },
        (errors) => {
          if (version !== generation.current || basis !== source.current?.basis) {
            productForm.form.clearErrors();
            return;
          }
          invalidFocus.current = {
            kind: 'product',
            field: Object.keys(errors).find((key) => key in productMessages) ?? '',
          };
        }
      )();
    } finally {
      productForm.setValidationPending(false);
    }
  }
  async function savePrice(event: FormEvent) {
    event.preventDefault();
    if (
      !detail ||
      !ready() ||
      preference.status !== 'ready' ||
      productForm.isPending() ||
      priceForm.isPending() ||
      savingBusy ||
      action
    )
      return;
    const version = generation.current,
      basis = source.current?.basis;
    priceForm.setValidationPending(true);
    try {
      await priceForm.form.handleSubmit(
        async (values) => {
          if (
            version !== generation.current ||
            basis !== source.current?.basis ||
            !ready() ||
            live.current.zoneState !== 'ready' ||
            live.current.zone !== zone
          )
            return;
          const effectiveFrom = values.scheduled ? priceInstant(values, zone) : undefined;
          if (values.scheduled && !effectiveFrom) return;
          setInvalidDate(false);
          commandKind.current = 'price';
          propose(
            `${base}/${detail.id}/prices`,
            'POST',
            label('savePrice'),
            label('confirmPrice'),
            { price: catalogueInteger(values.price), ...(effectiveFrom ? { effectiveFrom } : {}) }
          );
        },
        (errors) => {
          if (version !== generation.current || basis !== source.current?.basis) {
            priceForm.form.clearErrors();
            return;
          }
          invalidFocus.current = {
            kind: 'price',
            field: Object.keys(errors).find((key) => key in priceMessages) ?? '',
          };
        }
      )();
    } finally {
      priceForm.setValidationPending(false);
    }
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
      {uncertainCreate && !action && <p role="alert">{label('unverifiedCreate')}</p>}
      {saved && <p role="status">{label('saved')}</p>}
      <div>
        <div className="max-w-full overflow-x-auto pb-2">
          <div role="tablist" aria-label={label('title')} className="flex w-max gap-2">
            {types.map((value, index) => (
              <Button
                key={value}
                autoFocus={focusCategory && type === value}
                role="tab"
                disabled={blocked}
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
                        <Button disabled={blocked || uncertainCreate} onClick={() => choose('new')}>
                          {label('add')}
                        </Button>
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
                      noValidate
                      aria-busy={productForm.pending || undefined}
                      onSubmit={save}
                      className="flex flex-col gap-4 border-y py-5"
                    >
                      <fieldset
                        disabled={blocked}
                        className="flex min-w-0 flex-col gap-4 border-0 p-0"
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
                              {...productForm.bind(field)}
                              value={draft[field]}
                              onChange={(event) =>
                                setDraft({ ...draft, [field]: event.target.value })
                              }
                            />
                            {feedback(field)}
                          </div>
                        ))}
                        {(['descriptionFa', 'descriptionEn'] as const).map((field) => (
                          <div key={field}>
                            <Label htmlFor={`catalogue-${field}`}>{label(field)}</Label>
                            <Textarea
                              id={`catalogue-${field}`}
                              dir={field === 'descriptionFa' ? 'rtl' : 'ltr'}
                              {...productForm.bind(field)}
                              value={draft[field]}
                              onChange={(event) =>
                                setDraft({ ...draft, [field]: event.target.value })
                              }
                            />
                            {feedback(field)}
                          </div>
                        ))}
                        {editor === 'new' && (
                          <div>
                            <Label htmlFor="catalogue-initial-price">{label('initialPrice')}</Label>
                            <Input
                              id="catalogue-initial-price"
                              {...productForm.bind('price')}
                              dir="ltr"
                              inputMode="numeric"
                              value={draft.price}
                              onChange={(event) =>
                                setDraft({ ...draft, price: event.target.value })
                              }
                            />
                            {feedback('price')}
                            <p className="mt-2 text-sm">
                              {label('status')}: {label('inactive')}
                            </p>
                          </div>
                        )}
                        {!!categoryOptions[type].length && (
                          <fieldset
                            id="catalogue-categories"
                            tabIndex={-1}
                            {...groupBinding('categories')}
                            className="rounded-md border p-4"
                          >
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
                            {feedback('categories')}
                          </fieldset>
                        )}
                        {type === 'saving_plan' && (
                          <fieldset
                            id="catalogue-hardwareIds"
                            tabIndex={-1}
                            {...groupBinding('hardwareIds')}
                            className="rounded-md border p-4"
                          >
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
                              {draft.hardwareIds
                                .filter(
                                  (id) =>
                                    !hardwareOptions.some(
                                      (item) => item.id === id && item.status !== 'archived'
                                    )
                                )
                                .map((id) => (
                                  <label key={id} className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked
                                      onChange={() =>
                                        setDraft({
                                          ...draft,
                                          hardwareIds: draft.hardwareIds.filter(
                                            (value) => value !== id
                                          ),
                                        })
                                      }
                                    />
                                    {label('unavailable')} · <bdi>{id}</bdi>
                                  </label>
                                ))}
                            </div>
                            {feedback('hardwareIds')}
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
                                        inputMode="numeric"
                                        {...productForm.bind(field)}
                                        value={draft[field]}
                                        onChange={(event) =>
                                          setDraft({ ...draft, [field]: event.target.value })
                                        }
                                      />
                                      {feedback(field)}
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </fieldset>
                        )}
                        <div className="flex gap-2">
                          <Button type="submit" disabled={!ready() || uncertainCreate}>
                            {productForm.pending && (
                              <span
                                aria-hidden="true"
                                className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                              />
                            )}
                            {label(productForm.pending ? 'working' : 'save')}
                          </Button>
                          <Button type="button" variant="outline" onClick={() => choose(null)}>
                            {label('cancel')}
                          </Button>
                        </div>
                      </fieldset>
                      {productForm.errors.root && (
                        <p role="alert">
                          {productForm.errors.root.validation?.message ??
                            productForm.errors.root.message}
                        </p>
                      )}
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
                            disabled={blocked || !ready()}
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
                              disabled={blocked || !ready()}
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
                          disabled={blocked || !ready()}
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
                        disabled={pending || action !== null || !ready()}
                        refreshVersion={revision + detailRevision}
                        onBusyChange={setSavingBusy}
                        onDenied={denyAccess}
                      />
                    )}
                    {detail && type === 'hardware' && (
                      <SavingInventoryPanel
                        hardwareId={detail.id}
                        disabled={pending || action !== null || !ready()}
                        refreshVersion={revision + detailRevision}
                        onBusyChange={setSavingBusy}
                        onDenied={denyAccess}
                      />
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
                              disabled={blocked || !ready()}
                              onClick={() => {
                                if (blocked || !ready()) return;
                                priceForm.form.reset(priceDefaults);
                                setPriceOpen(true);
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
                            noValidate
                            aria-busy={priceForm.pending || undefined}
                            onSubmit={savePrice}
                            className="flex flex-col gap-4"
                          >
                            <fieldset
                              disabled={blocked}
                              className="flex min-w-0 flex-col gap-4 border-0 p-0"
                            >
                              <div>
                                <Label htmlFor="catalogue-price">{label('price')}</Label>
                                <Input
                                  id="catalogue-price"
                                  {...priceForm.bind('price')}
                                  dir="ltr"
                                  inputMode="numeric"
                                  value={price}
                                  onChange={(event) => setPrice(event.target.value)}
                                />
                                {priceFeedback('price')}
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
                                  <div className="min-w-0">
                                    <DatePicker
                                      id="catalogue-date"
                                      triggerProps={priceForm.bind('date')}
                                      onBlur={priceForm.bind('date').onBlur}
                                      label={label('date')}
                                      placeholder={label('chooseDate')}
                                      locale={locale}
                                      timezone={zone}
                                      {...(date ? { value: date } : {})}
                                      onChange={(value) => {
                                        setDate(value);
                                        setInvalidDate(false);
                                      }}
                                    />
                                    {priceFeedback('date')}
                                  </div>
                                  <div>
                                    <Label htmlFor="catalogue-time">{label('time')}</Label>
                                    <Input
                                      id="catalogue-time"
                                      {...priceForm.bind('time')}
                                      dir="ltr"
                                      type="time"
                                      value={time}
                                      onChange={(event) => setTime(event.target.value)}
                                    />
                                    {priceFeedback('time')}
                                  </div>
                                </div>
                              )}
                              {invalidDate && <p role="alert">{label('invalidDate')}</p>}
                              <div className="flex gap-2">
                                <Button
                                  type="submit"
                                  disabled={!ready() || preference.status !== 'ready'}
                                >
                                  {priceForm.pending && (
                                    <span
                                      aria-hidden="true"
                                      className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                                    />
                                  )}
                                  {label(priceForm.pending ? 'working' : 'savePrice')}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => setPriceOpen(false)}
                                >
                                  {label('cancel')}
                                </Button>
                              </div>
                            </fieldset>
                            {priceForm.errors.root && (
                              <p role="alert">
                                {priceForm.errors.root.validation?.message ??
                                  priceForm.errors.root.message}
                              </p>
                            )}
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
                          disabled={blocked}
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
          summary={
            <div className="space-y-2">
              {uncertainCreate && <p role="alert">{label('unverifiedCreate')}</p>}
              <Button
                type="button"
                variant="outline"
                disabled={detailState === 'loading' || state === 'loading'}
                onClick={refresh}
              >
                {label('refresh')}
              </Button>
              {detailState === 'error' && <p role="alert">{label('detailError')}</p>}
              {hardwareState === 'error' && (
                <>
                  <p role="alert">{label('hardwareError')}</p>
                  <Button type="button" onClick={() => setHardwareRevision((value) => value + 1)}>
                    {label('retry')}
                  </Button>
                </>
              )}
              {preference.status === 'error' && (
                <>
                  <p role="alert">{label('timezoneError')}</p>
                  <Button type="button" onClick={preference.retry}>
                    {label('retry')}
                  </Button>
                </>
              )}
            </div>
          }
          finalFocus={false}
          onDenied={denyAccess}
          confirmationDisabled={
            uncertainCreate ||
            !ready() ||
            (commandKind.current === 'price' && preference.status !== 'ready')
          }
          onValidationError={(fields) => {
            if (commandVersion.current !== generation.current) return false;
            if (commandKind.current === 'product') {
              const allowed = [
                'titleFa',
                'titleEn',
                'descriptionFa',
                'descriptionEn',
                ...(editor === 'new' ? ['price'] : []),
                ...(categoryOptions[type].length ? ['categories'] : []),
                ...(type === 'saving_plan' ? ['hardwareIds'] : []),
                ...(type === 'electricity' && draft?.configureLimits ? ['minKwh', 'maxKwh'] : []),
              ];
              return (
                fields.every((field) => typeof field === 'string' && allowed.includes(field)) &&
                productErrors(fields)
              );
            }
            if (commandKind.current === 'price')
              return (
                fields.every(
                  (field) =>
                    field === 'price' || (scheduled && (field === 'date' || field === 'time'))
                ) && priceErrors(fields)
              );
            return false;
          }}
          onClose={() => {
            generation.current++;
            setAction(null);
          }}
          onSuccess={((version, selected, kind) => async (result) => {
            if (version !== generation.current || accessDenied.current) return;
            const matched =
              kind === 'price'
                ? selected !== null && matchesPriceReceipt(action.body, result, selected)
                : action.path.endsWith('/duplicate-policy')
                  ? record(result) &&
                    record(action.body) &&
                    result.preventActiveDuplicates === action.body.preventActiveDuplicates
                  : action.method === 'DELETE'
                    ? result === null
                    : matchesProductReceipt(action.body, result, selected, type);
            if (!matched) {
              if (editor === 'new') setUncertainCreate(true);
              throw new Error('Invalid catalogue acknowledgement');
            }
            choose(action.path.endsWith('/duplicate-policy') ? editor : null);
            setSaved(true);
            setRevision((value) => value + 1);
          })(commandVersion.current, detail, commandKind.current)}
        />
      )}
    </div>
  );
}
