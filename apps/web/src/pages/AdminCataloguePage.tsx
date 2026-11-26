import { ChevronDown, Pencil as TablePencilIcon } from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { RecordTimeInput } from '../components/RecordTimeInput.js';
import { Link } from '@tanstack/react-router';
import {
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
} from '../components/RecordEditorLayout.js';
import {
  keepRecordFieldVisible,
  recordEditorFormSurface,
  StickyRecordEditorActions,
} from '../components/StickyRecordEditorActions.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
} from '../components/CatalogueEditorFeedback.js';
import { ProductCatalogueFilters } from '../components/ProductCatalogueFilters.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import type { ProductCatalogueType } from '../lib/catalogue-category-query.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  LoadingStatus,
  Button,
  Badge,
  CurrencyCell,
  TextCell,
  DatePicker,
  datePickerAtTime,
  Input,
  Label,
  ListPage,
  ListRefreshButton,
  Textarea,
  buttonVariants,
} from '@barghsa/ui';
import { tCatalogue } from '@barghsa/i18n/catalogue';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useTimezone } from '../hooks/useTimezone.js';
import { useLocale } from '../hooks/useLocale.js';
import { useStaffQueryRead } from '../hooks/useStaffQueryRead.js';
import { serverListParams } from '../lib/query-keys.js';
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
const SavingPlanHardwarePicker = lazy(() => import('../components/SavingPlanHardwarePicker.js'));
export type CatalogueView = 'list' | 'new' | 'detail' | 'edit' | 'price' | 'configuration';
export type SavingConfigurationEditor = 'agreement' | 'activate-agreement';
export default function AdminCataloguePage({
  queries,
  initialType = 'consultation',
  onTypeChange,
  focusCategory = false,
  selection,
  view,
  onRecordSaved,
  routeSearch,
  configurationEditor,
}: {
  queries?: ListQueryBinding;
  initialType?: ProductCatalogueType;
  focusCategory?: boolean;
  onTypeChange?: (value: ProductCatalogueType) => void;
  selection?: { id: string | null; set: (id: string | null, replace?: boolean) => void };
  view?: CatalogueView;
  onRecordSaved?: (id: string) => void;
  routeSearch?: Record<string, unknown>;
  configurationEditor?: SavingConfigurationEditor;
} = {}) {
  const preference = useTimezone(!view || view === 'detail' || view === 'price');
  const locale = useLocale();
  const read = useStaffQueryRead('catalogue');
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => tCatalogue(key, locale);
  const listView = !view || view === 'list';
  const productFormView = !view || view === 'new' || view === 'edit';
  const detailsView = !view || view === 'detail';
  const pricesView = detailsView || view === 'price';
  const configView = !view || view === 'configuration';
  const [type, setType] = useState<ProductType>(initialType),
    [rows, setRows] = useState<Product[]>([]);
  const [hardwareOptions, setHardwareOptions] = useState<Product[]>([]);
  const [preventActiveDuplicates, setPreventActiveDuplicates] = useState(true);
  const requestedId = selection?.id;
  const address = useRef(requestedId ?? null);
  const [editor, setEditor] = useState<string | null>(requestedId ?? null),
    [detail, setDetail] = useState<Detail | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading'),
    [revision, setRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const listCriteria = new URLSearchParams(queries?.params);
  listCriteria.set('type', type);
  const listKey = listCriteria.toString();
  const criteriaKey = serverListParams(listCriteria).criteria;
  const previousListKey = useRef(criteriaKey);
  const [detailRevision, setDetailRevision] = useState(0);
  const [hardwareRevision, setHardwareRevision] = useState(0);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('ready');
  const [hardwareState, setHardwareState] = useState<'loading' | 'ready' | 'error'>('ready');
  const [listAccepted, setListAccepted] = useState(-1);
  const [detailAccepted, setDetailAccepted] = useState(-1);
  const [hardwareAccepted, setHardwareAccepted] = useState(-1);
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
  const descriptionRefs = useMemo(() => {
    function revealOnFocus(field: 'descriptionFa' | 'descriptionEn') {
      return (element: HTMLTextAreaElement | null) =>
        register(field).ref(
          element
            ? {
                focus: () => {
                  const disclosure = element.closest('details');
                  if (disclosure) disclosure.open = true;
                  element.focus();
                },
              }
            : null
        );
    }
    return {
      descriptionFa: revealOnFocus('descriptionFa'),
      descriptionEn: revealOnFocus('descriptionEn'),
    };
  }, [register]);
  function groupBinding(field: 'categories' | 'hardwareIds') {
    const binding = productForm.bind(field);
    return {
      ...binding,
      // Keep a stable focus proxy: registering the fieldset discovers its first checkbox's 'on'.
      ref: field === 'categories' ? categoriesRef : hardwareRef,
    };
  }
  function feedback(field: keyof Draft) {
    return (
      <CatalogueFieldFeedback
        compact
        id={productForm.errorId(field)}
        error={productForm.errors[field]}
        message={productMessages[field]}
      />
    );
  }
  function priceFeedback(field: keyof PriceDraft) {
    return (
      <CatalogueFieldFeedback
        compact
        id={priceForm.errorId(field)}
        error={priceForm.errors[field]}
        message={priceMessages[field]}
      />
    );
  }
  const generation = useRef(0),
    commandVersion = useRef(0),
    commandKind = useRef<'product' | 'price' | 'other'>('other');
  const source = useRef<{ scope: string; basis: string } | null>(null),
    acceptedReferences = useRef<References | null>(null);
  const [uncertainCreate, setUncertainCreate] = useState(false);
  const [requiredRead, setRequiredRead] = useState<{
    revision: number;
    editor: string | null;
  } | null>(null);
  const readsCollection = listView || (view === 'new' && requiredRead !== null);
  const accessDenied = useRef(false);
  const hasEditor = editor !== null;
  const [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false),
    [references, setReferences] = useState<References | null>(null);
  const [pendingAction, setPendingAction] = useState<TeamAction | null>(null);
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
  const commandPending = action !== null && action === pendingAction;
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
    requiredRead === null &&
    live.current.detailState === 'ready' &&
    (live.current.type !== 'saving_plan' ||
      !productFormView ||
      live.current.hardwareState === 'ready');
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
    choose(null, view ? 'route' : 'settled');
    setRequiredRead(null);
    accessDenied.current = true;
    setState('denied');
    setRows([]);
    setHardwareOptions([]);
  }
  useEffect(() => {
    if (!readsCollection) return;
    const abort = new AbortController();
    accessDenied.current = false;
    if (previousListKey.current !== criteriaKey) {
      setRows([]);
      setHasNextPage(false);
      previousListKey.current = criteriaKey;
    }
    setState('loading');
    void read(
      `${base}?${listKey}`,
      'list',
      abort.signal,
      async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const data: unknown = await response.json();
        if (!validProducts(data, type)) throw new Error('Invalid catalogue');
        const next = response.headers.get('X-Has-Next-Page');
        if (
          queries &&
          (data.length > queries.query.pageSize ||
            data.some(
              (row) => queries.query.filters.status && row.status !== queries.query.filters.status
            ) ||
            (next !== null && next !== 'true' && next !== 'false') ||
            (next === 'true' && data.length !== queries.query.pageSize))
        )
          throw new Error('Invalid catalogue page');
        return {
          products: data,
          hasNext:
            next === null ? !!queries && data.length === queries.query.pageSize : next === 'true',
        };
      },
      revision
    )
      .then(({ products, hasNext }) => {
        if (abort.signal.aborted || accessDenied.current) return;
        setRows(products);
        setHasNextPage(hasNext);
        setListAccepted(revision);
        setState('ready');
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted || accessDenied.current) return;
        if (cause instanceof Error && ['401', '403'].includes(cause.message)) denyAccess();
        else setState('error');
      });
    return () => abort.abort();
  }, [type, listKey, revision, listRevision, criteriaKey, read, readsCollection]);
  useEffect(() => {
    const abort = new AbortController();
    if (type !== 'saving_plan' || !hasEditor || !productFormView || accessDenied.current) {
      setHardwareState('ready');
      return;
    }
    setHardwareState('loading');
    void read(
      `${base}?type=hardware`,
      'list',
      abort.signal,
      async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const data: unknown = await response.json();
        if (!validProducts(data, 'hardware')) throw new Error('Invalid hardware');
        return data;
      },
      revision
    )
      .then((products) => {
        if (abort.signal.aborted || accessDenied.current) return;
        setHardwareOptions(products);
        setHardwareAccepted(revision);
        setHardwareState('ready');
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted || accessDenied.current) return;
        if (cause instanceof Error && ['401', '403'].includes(cause.message)) denyAccess();
        else setHardwareState('error');
      });
    return () => abort.abort();
  }, [type, hasEditor, revision, hardwareRevision, read, productFormView]);
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
      setDetailAccepted(revision);
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
        const packets = await Promise.all(
          paths.map((path) =>
            read(
              path,
              'detail',
              abort.signal,
              async (response) => ({
                status: response.status,
                ok: response.ok,
                data: response.ok ? await response.json().catch(() => null) : null,
              }),
              revision
            )
          )
        );
        if (packets.some((response) => response.status === 401 || response.status === 403)) {
          if (!abort.signal.aborted) denyAccess();
          return;
        }
        if (packets.some((response) => !response.ok)) throw new Error('Load failed');
        const data = packets.map((packet) => packet.data);
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
  }, [type, editor, revision, detailRevision, read]);
  useEffect(() => {
    if (!requiredRead) return;
    if (readsCollection && (state !== 'ready' || listAccepted < requiredRead.revision)) return;
    if (
      editor !== null &&
      editor === requiredRead.editor &&
      (detailState !== 'ready' ||
        detailAccepted < requiredRead.revision ||
        (type === 'saving_plan' &&
          productFormView &&
          (hardwareState !== 'ready' || hardwareAccepted < requiredRead.revision)))
    )
      return;
    if (!uncertainCreate) {
      generation.current++;
      setAction(null);
    }
    setRequiredRead(null);
  }, [
    requiredRead,
    readsCollection,
    productFormView,
    state,
    listAccepted,
    editor,
    detailState,
    detailAccepted,
    type,
    hardwareState,
    hardwareAccepted,
    uncertainCreate,
  ]);
  useEffect(() => {
    const current = live.current;
    if (
      !listView ||
      !current.editor ||
      current.editor === 'new' ||
      !current.detail ||
      accessDenied.current ||
      state !== 'ready'
    )
      return;
    const row = rows.find((value) => value.id === current.editor);
    if (!row) {
      // A bounded or filtered page cannot establish that an independently loaded product was removed.
      if (!queries) choose(null);
      return;
    }
    if (JSON.stringify(productBasis(row)) !== JSON.stringify(productBasis(current.detail))) {
      generation.current++;
      setAction(null);
      setDetailRevision((value) => value + 1);
    }
  }, [rows, listView]);
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
  function choose(value: string | null, origin: 'user' | 'route' | 'settled' = 'user') {
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
    if (address.current !== value) {
      address.current = value;
      if (origin !== 'route') selection?.set(value, origin === 'settled');
    }
  }
  useLayoutEffect(() => {
    if (requestedId !== undefined && requestedId !== address.current) choose(requestedId, 'route');
  }, [requestedId]);
  function refresh() {
    if (commandPending) return;
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
    if (accessDenied.current || action || requiredRead || uncertainCreate || savingBusy) return;
    commandVersion.current = generation.current;
    if (heading !== label('save') && heading !== label('savePrice')) commandKind.current = 'other';
    setSaved(false);
    setAction({
      path,
      method,
      ...(method === 'PUT' &&
      body &&
      typeof body === 'object' &&
      'status' in body &&
      body.status === 'inactive'
        ? { risk: 'destructive' as const }
        : {}),
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
  const taskView = !!view && !listView && view !== 'detail';
  const delegatedHeading =
    view === 'configuration' && detail && draft && (type === 'hardware' || !!configurationEditor);
  const catalogueHeading = (
    <div className="min-w-0 space-y-1">
      {configurationEditor && requestedId && !blocked ? (
        <Link
          to="/admin/catalogue/$category/$productId/configuration/{-$operation}"
          params={{ category: type, productId: requestedId, operation: undefined }}
          search={routeSearch}
          className="touch-action text-sm text-primary underline underline-offset-4"
        >
          {label('backToConfiguration')}
        </Link>
      ) : (
        !!view &&
        !listView &&
        !blocked && (
          <Link
            to="/admin/catalogue/$category"
            params={{ category: type }}
            search={routeSearch}
            className="touch-action text-sm text-primary underline underline-offset-4"
          >
            {label(type)}
          </Link>
        )
      )}
      <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]">
        {view === 'detail' && detail
          ? title(detail)
          : label(
              view === 'new'
                ? 'add'
                : view === 'edit'
                  ? 'editProduct'
                  : view === 'price'
                    ? 'addPrice'
                    : view === 'configuration'
                      ? configurationEditor === 'agreement'
                        ? 'agreementDraftDetails'
                        : configurationEditor === 'activate-agreement'
                          ? 'activateAgreement'
                          : type === 'hardware'
                            ? 'inventory'
                            : 'configuration'
                      : 'title'
            )}
      </h1>
      {detail && view && view !== 'detail' && (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{title(detail)}</p>
      )}
    </div>
  );
  return (
    <div
      className={`mx-auto flex w-full min-w-0 flex-col gap-4 ${taskView ? 'max-w-3xl' : 'max-w-6xl'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {!delegatedHeading && (
        <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
          {catalogueHeading}
          {view &&
            !listView &&
            view !== 'new' &&
            (!configView || (type === 'saving_plan' && !configurationEditor)) &&
            state !== 'denied' && (
              <ListRefreshButton
                label={label('refresh')}
                onClick={refresh}
                disabled={commandPending}
              />
            )}
        </header>
      )}
      {!listView && state === 'denied' && <p role="alert">{label('denied')}</p>}
      {!listView && readsCollection && state === 'error' && (
        <div role="alert" className="space-y-2">
          <p>{label('error')}</p>
          <Button variant="outline" onClick={() => setListRevision((v) => v + 1)}>
            {label('retry')}
          </Button>
        </div>
      )}
      {uncertainCreate && !action && <p role="alert">{label('unverifiedCreate')}</p>}
      {requiredRead && !uncertainCreate && !action && (
        <p role="alert">{confirmationText('unconfirmed', locale)}</p>
      )}
      <CommandFeedback message={saved ? label('saved') : null} />
      {view === 'edit' && warning && (
        <p role="note" className="rounded-md border p-3">
          {warning}
        </p>
      )}
      <div>
        {listView && (
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
        )}
        {types
          .filter((value) => value === type)
          .map((value) => (
            <div
              key={value}
              role={listView ? 'tabpanel' : undefined}
              id={listView ? `catalogue-panel-${value}` : undefined}
              aria-labelledby={listView ? `catalogue-tab-${value}` : undefined}
              className="flex flex-col gap-5"
            >
              <ListPage>
                {listView && (
                  <ListPage.Toolbar
                    className="items-start"
                    filters={
                      queries && (
                        <ProductCatalogueFilters
                          locale={locale}
                          queries={queries}
                          disabled={blocked || uncertainCreate || state === 'denied'}
                        />
                      )
                    }
                    actions={
                      <>
                        <ListRefreshButton label={label('refresh')} onClick={refresh} />
                        {type !== 'electricity' &&
                          state !== 'denied' &&
                          (view === 'list' && !blocked ? (
                            <Link
                              to="/admin/catalogue/$category/new"
                              params={{ category: type }}
                              search={routeSearch}
                              className={buttonVariants({ className: 'min-h-11' })}
                            >
                              {label('add')}
                            </Link>
                          ) : (
                            <Button
                              disabled={blocked || requiredRead !== null || uncertainCreate}
                              onClick={() => choose('new')}
                            >
                              {label('add')}
                            </Button>
                          ))}
                      </>
                    }
                  />
                )}
                {pricesView && preference.status === 'loading' && (
                  <LoadingStatus>{label('loading')}</LoadingStatus>
                )}
                {pricesView && preference.status === 'error' && (
                  <div role="alert" className="space-y-2">
                    <p>{label('timezoneError')}</p>
                    <Button variant="outline" onClick={preference.retry}>
                      {label('retry')}
                    </Button>
                  </div>
                )}
                {editor &&
                  detailState === 'loading' &&
                  (detail ? (
                    <LoadingStatus>{label('loading')}</LoadingStatus>
                  ) : (
                    <RecordDetailSkeleton label={label('loading')} layout="payment" />
                  ))}
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
                    {productFormView && (
                      <form
                        aria-label={label('editor')}
                        noValidate
                        aria-busy={productForm.pending || undefined}
                        onSubmit={save}
                        onFocus={keepRecordFieldVisible}
                        className={recordEditorFormSurface}
                      >
                        <fieldset disabled={blocked} className="min-w-0">
                          <legend className="sr-only">{label('editor')}</legend>
                          <RecordEditorSection
                            title={label('productDetails')}
                            description={label('productCopyHelp')}
                          >
                            {detail?.systemKey && (
                              <p className="text-sm text-muted-foreground">{label('system')}</p>
                            )}
                            <div className={`${recordEditorGrid} items-start gap-y-4`}>
                              {(
                                [
                                  ['titleFa', 'descriptionFa', 'fa', 'rtl'],
                                  ['titleEn', 'descriptionEn', 'en', 'ltr'],
                                ] as const
                              ).map(([titleField, descriptionField, language, direction]) => {
                                const description = draft[descriptionField];
                                const id = `catalogue-${descriptionField}`;
                                return (
                                  <div key={titleField} className="min-w-0 space-y-1.5">
                                    <div className={recordEditorField}>
                                      <Label htmlFor={`catalogue-${titleField}`}>
                                        {label(titleField)}
                                      </Label>
                                      <Input
                                        id={`catalogue-${titleField}`}
                                        dir={direction}
                                        lang={language}
                                        {...productForm.bind(titleField)}
                                        required
                                        value={draft[titleField]}
                                        onChange={(event) =>
                                          setDraft({ ...draft, [titleField]: event.target.value })
                                        }
                                      />
                                      {feedback(titleField)}
                                    </div>
                                    <details className="group min-w-0 rounded-lg border bg-muted/20">
                                      <summary
                                        aria-labelledby={`${id}-summary`}
                                        aria-describedby={
                                          productForm.errors[descriptionField]
                                            ? productForm.errorId(descriptionField)
                                            : undefined
                                        }
                                        className="flex min-h-11 min-w-0 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
                                      >
                                        <span className="min-w-0">
                                          <span
                                            id={`${id}-summary`}
                                            className="block font-medium text-primary"
                                          >
                                            {label(descriptionField)}
                                          </span>
                                          {description.trim() && (
                                            <bdi
                                              lang={language}
                                              dir={direction}
                                              className="mt-0.5 line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere] group-open:hidden"
                                            >
                                              {description}
                                            </bdi>
                                          )}
                                        </span>
                                        <ChevronDown
                                          aria-hidden="true"
                                          className="size-4 shrink-0 text-primary transition-transform group-open:rotate-180 motion-reduce:transition-none"
                                        />
                                      </summary>
                                      <div className="min-w-0 px-3 pb-2">
                                        <Label htmlFor={id} className="sr-only">
                                          {label(descriptionField)}
                                        </Label>
                                        <Textarea
                                          {...productForm.bind(descriptionField)}
                                          ref={descriptionRefs[descriptionField]}
                                          id={id}
                                          dir={direction}
                                          lang={language}
                                          rows={2}
                                          className="max-h-40 min-h-14 resize-y"
                                          placeholder={tCatalogue(
                                            'productDescriptionExample',
                                            language
                                          )}
                                          value={description}
                                          onChange={(event) =>
                                            setDraft({
                                              ...draft,
                                              [descriptionField]: event.target.value,
                                            })
                                          }
                                        />
                                      </div>
                                    </details>
                                    {productForm.errors[descriptionField] &&
                                      feedback(descriptionField)}
                                  </div>
                                );
                              })}
                            </div>
                          </RecordEditorSection>
                          {!!categoryOptions[type].length && (
                            <RecordEditorSection title={label('categories')}>
                              <fieldset
                                id="catalogue-categories"
                                tabIndex={-1}
                                {...groupBinding('categories')}
                                className="min-w-0"
                              >
                                <legend className="sr-only">{label('categories')}</legend>
                                <div className={recordEditorGrid}>
                                  {categoryOptions[type].map((category) => (
                                    <label
                                      key={category}
                                      className="flex min-h-9 cursor-pointer items-center gap-2"
                                    >
                                      <input
                                        type="checkbox"
                                        className="size-4 accent-primary"
                                        checked={draft.categories.includes(category)}
                                        onChange={(event) =>
                                          setDraft({
                                            ...draft,
                                            categories: event.target.checked
                                              ? [...draft.categories, category]
                                              : draft.categories.filter(
                                                  (value) => value !== category
                                                ),
                                          })
                                        }
                                      />
                                      {label(category)}
                                    </label>
                                  ))}
                                </div>
                                {feedback('categories')}
                              </fieldset>
                            </RecordEditorSection>
                          )}
                          {type === 'saving_plan' && (
                            <RecordEditorSection
                              title={label('planHardware')}
                              description={label('planHardwareHelp')}
                            >
                              <fieldset
                                id="catalogue-hardwareIds"
                                tabIndex={-1}
                                {...groupBinding('hardwareIds')}
                                className="min-w-0"
                              >
                                <legend className="sr-only">{label('planHardware')}</legend>
                                {hardwareState === 'loading' && (
                                  <LoadingStatus>{label('loading')}</LoadingStatus>
                                )}
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
                                {(hardwareState === 'ready' ||
                                  hardwareOptions.length > 0 ||
                                  draft.hardwareIds.length > 0) && (
                                  <Suspense
                                    fallback={<LoadingStatus>{label('loading')}</LoadingStatus>}
                                  >
                                    <SavingPlanHardwarePicker
                                      key={editor}
                                      options={hardwareOptions}
                                      selected={draft.hardwareIds}
                                      locale={locale}
                                      title={title}
                                      money={money}
                                      onChange={(hardwareIds) =>
                                        setDraft({ ...draft, hardwareIds })
                                      }
                                    />
                                  </Suspense>
                                )}
                                {feedback('hardwareIds')}
                              </fieldset>
                            </RecordEditorSection>
                          )}
                          {type === 'electricity' && (
                            <RecordEditorSection title={label('limits')}>
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
                                  <div className={recordEditorGrid}>
                                    {(['minKwh', 'maxKwh'] as const).map((field) => (
                                      <div key={field} className={recordEditorField}>
                                        <Label htmlFor={`catalogue-${field}`}>{label(field)}</Label>
                                        <Input
                                          id={`catalogue-${field}`}
                                          inputMode="numeric"
                                          dir="ltr"
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
                            </RecordEditorSection>
                          )}
                          {editor === 'new' && (
                            <RecordEditorSection title={label('priceEditor')}>
                              <div className={`max-w-sm ${recordEditorField}`}>
                                <Label htmlFor="catalogue-initial-price">
                                  {label('initialPrice')}
                                </Label>
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
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {label('launchStatus')}
                              </p>
                            </RecordEditorSection>
                          )}
                          {productForm.errors.root && (
                            <p role="alert" className="px-4 py-3 text-sm text-destructive sm:px-6">
                              {productForm.errors.root.validation?.message ??
                                productForm.errors.root.message}
                            </p>
                          )}
                          <StickyRecordEditorActions>
                            {view && !blocked ? (
                              <Link
                                to={
                                  detail
                                    ? '/admin/catalogue/$category/$productId'
                                    : '/admin/catalogue/$category'
                                }
                                params={
                                  detail
                                    ? { category: type, productId: detail.id }
                                    : { category: type }
                                }
                                search={routeSearch}
                                className={buttonVariants({ variant: 'ghost' })}
                              >
                                {label('cancel')}
                              </Link>
                            ) : (
                              <Button type="button" variant="ghost" onClick={() => choose(null)}>
                                {label('cancel')}
                              </Button>
                            )}
                            <CatalogueSaveButton
                              label={label(productForm.pending ? 'working' : 'save')}
                              pending={productForm.pending}
                              disabled={!ready() || uncertainCreate}
                            />
                          </StickyRecordEditorActions>
                        </fieldset>
                      </form>
                    )}
                    {detail && view === 'detail' && (
                      <section
                        aria-label={label('productName')}
                        className="space-y-4 rounded-xl border bg-card p-4 sm:p-6"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-muted/45 p-3">
                          <dl>
                            <dt className="text-sm text-muted-foreground">{label('price')}</dt>
                            <dd className="text-xl font-semibold tabular-nums wrap-anywhere">
                              <bdi>{money(detail.price)}</bdi>
                            </dd>
                          </dl>
                          <Badge variant="outline">{label(detail.status)}</Badge>
                        </div>
                        {(detail.description?.[locale] ||
                          detail.description?.[locale === 'fa' ? 'en' : 'fa']) && (
                          <p className="whitespace-pre-line [overflow-wrap:anywhere]">
                            {detail.description[locale] ||
                              detail.description[locale === 'fa' ? 'en' : 'fa']}
                          </p>
                        )}
                        {!!detail.categories.length && (
                          <ul className="flex flex-wrap gap-2">
                            {detail.categories.map((category) => (
                              <li key={category}>
                                <Badge variant="outline">{label(category)}</Badge>
                              </li>
                            ))}
                          </ul>
                        )}
                        {!blocked && (
                          <div className="flex flex-wrap gap-2">
                            <Link
                              to="/admin/catalogue/$category/$productId/edit"
                              params={{ category: type, productId: detail.id }}
                              search={routeSearch}
                              className={buttonVariants({ className: 'min-h-11' })}
                            >
                              {label('editProduct')}
                            </Link>
                            {(type === 'saving_plan' || type === 'hardware') && (
                              <Link
                                to="/admin/catalogue/$category/$productId/configuration/{-$operation}"
                                params={{ category: type, productId: detail.id }}
                                search={routeSearch}
                                className={buttonVariants({
                                  variant: 'outline',
                                  className: 'min-h-11',
                                })}
                              >
                                {label('configuration')}
                              </Link>
                            )}
                          </div>
                        )}
                      </section>
                    )}
                    {detail && detailsView && (
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
                    {detail && configView && !configurationEditor && type === 'saving_plan' && (
                      <section
                        className="space-y-2 rounded-xl border bg-card p-4 sm:px-6"
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
                    {detail && configView && type === 'saving_plan' && (
                      <SavingAgreementEditor
                        planId={detail.id}
                        mode={view ? (configurationEditor ?? 'overview') : 'inline'}
                        search={routeSearch ?? {}}
                        onProductRefresh={refresh}
                        {...(delegatedHeading && { heading: catalogueHeading })}
                        onChanged={() => choose(detail.id)}
                        disabled={pending || action !== null || !ready()}
                        refreshVersion={revision + detailRevision}
                        onBusyChange={setSavingBusy}
                        onDenied={denyAccess}
                      />
                    )}
                    {detail && configView && type === 'hardware' && (
                      <SavingInventoryPanel
                        hardwareId={detail.id}
                        standalone={!!view}
                        onProductRefresh={refresh}
                        {...(delegatedHeading && { heading: catalogueHeading })}
                        disabled={pending || action !== null || !ready()}
                        refreshVersion={revision + detailRevision}
                        onBusyChange={setSavingBusy}
                        onDenied={denyAccess}
                      />
                    )}
                    {detail && pricesView && preference.status === 'ready' && (
                      <section aria-label={label('history')} className="min-w-0 space-y-4">
                        {view !== 'price' && (
                          <div className="space-y-1">
                            <h2 className="text-xl font-semibold">{label('history')}</h2>
                            <p>
                              {label('price')}: {money(detail.price)}
                            </p>
                            <p className="text-sm">
                              {label('timezone')}: <bdi>{zone}</bdi>
                            </p>
                          </div>
                        )}
                        {view === 'detail' && !blocked && ready() && (
                          <Link
                            to="/admin/catalogue/$category/$productId/prices/new"
                            params={{ category: type, productId: detail.id }}
                            search={routeSearch}
                            className={buttonVariants({
                              variant: 'outline',
                              className: 'w-fit min-h-11',
                            })}
                          >
                            {label('addPrice')}
                          </Link>
                        )}
                        {!view && !priceOpen && (
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
                        {(view === 'price' || priceOpen) && (
                          <form
                            aria-label={label('priceEditor')}
                            noValidate
                            aria-busy={priceForm.pending || undefined}
                            onSubmit={savePrice}
                            onFocus={keepRecordFieldVisible}
                            className={recordEditorFormSurface}
                          >
                            <fieldset disabled={blocked} className="min-w-0">
                              <legend className="sr-only">{label('priceEditor')}</legend>
                              <RecordEditorSection title={label('priceEditor')}>
                                <div className="flex max-w-sm flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/35 px-3 py-2">
                                  <span className="text-sm text-muted-foreground">
                                    {label('currentPrice')}
                                  </span>
                                  <span className="font-semibold">{money(detail.price)}</span>
                                </div>
                                <div className={`max-w-sm ${recordEditorField}`}>
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
                              </RecordEditorSection>
                              <RecordEditorSection title={label('priceTiming')}>
                                <fieldset className="grid min-w-0 gap-2 sm:grid-cols-2">
                                  <legend className="sr-only">{label('priceTiming')}</legend>
                                  {(['now', 'scheduled'] as const).map((option) => (
                                    <label
                                      key={option}
                                      className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm has-checked:border-primary/35 has-checked:bg-primary/5"
                                    >
                                      <input
                                        type="radio"
                                        name="catalogue-price-timing"
                                        value={option}
                                        className="size-4 shrink-0 accent-primary"
                                        checked={scheduled === (option === 'scheduled')}
                                        onChange={() => setScheduled(option === 'scheduled')}
                                        aria-describedby="catalogue-price-timing-help"
                                      />
                                      {label(option === 'scheduled' ? 'schedule' : 'applyNow')}
                                    </label>
                                  ))}
                                </fieldset>
                                <p
                                  id="catalogue-price-timing-help"
                                  className="text-sm text-muted-foreground"
                                >
                                  {label(scheduled ? 'scheduledHelp' : 'immediate')}
                                </p>
                                {scheduled && (
                                  <p className="text-xs text-muted-foreground">
                                    {label('timezone')} · <bdi>{zone}</bdi>
                                  </p>
                                )}
                                {scheduled && (
                                  <div className={recordEditorGrid}>
                                    <div className={recordEditorField}>
                                      <Label htmlFor="catalogue-date">{label('date')}</Label>
                                      <DatePicker
                                        id="catalogue-date"
                                        className="min-h-11"
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
                                    <div className={recordEditorField}>
                                      <Label htmlFor="catalogue-time">{label('time')}</Label>
                                      <RecordTimeInput
                                        id="catalogue-time"
                                        {...priceForm.bind('time')}
                                        locale={locale}
                                        value={time}
                                        onChange={setTime}
                                      />
                                      {priceFeedback('time')}
                                    </div>
                                  </div>
                                )}
                                {invalidDate && <p role="alert">{label('invalidDate')}</p>}
                              </RecordEditorSection>
                              {priceForm.errors.root && (
                                <p
                                  role="alert"
                                  className="px-4 py-3 text-sm text-destructive sm:px-6"
                                >
                                  {priceForm.errors.root.validation?.message ??
                                    priceForm.errors.root.message}
                                </p>
                              )}
                              <StickyRecordEditorActions>
                                {view === 'price' && !blocked ? (
                                  <Link
                                    to="/admin/catalogue/$category/$productId"
                                    params={{ category: type, productId: detail.id }}
                                    search={routeSearch}
                                    className={buttonVariants({ variant: 'ghost' })}
                                  >
                                    {label('cancel')}
                                  </Link>
                                ) : (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setPriceOpen(false)}
                                  >
                                    {label('cancel')}
                                  </Button>
                                )}
                                <CatalogueSaveButton
                                  label={label(priceForm.pending ? 'working' : 'savePrice')}
                                  pending={priceForm.pending}
                                  disabled={!ready() || preference.status !== 'ready'}
                                />
                              </StickyRecordEditorActions>
                            </fieldset>
                          </form>
                        )}
                        <div className="min-w-0 space-y-2 rounded-xl border bg-card px-4 py-4 sm:px-6">
                          {view === 'price' && (
                            <h2 className="text-base font-semibold">{label('history')}</h2>
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
                        </div>
                      </section>
                    )}
                  </>
                )}
                {listView && (
                  <ListPage.Content
                    loading={state === 'loading'}
                    error={state === 'error' || state === 'denied'}
                    empty={!rows.length}
                    retainContent={!!rows.length && state !== 'denied'}
                    loadingView={
                      <>
                        <div className="md:hidden">
                          <RecordListSkeleton label={label('loading')} view="card" headings={[]} />
                        </div>
                        <div className="hidden md:block">
                          <RecordListSkeleton
                            label={label('loading')}
                            view="table"
                            headings={[
                              label('productName'),
                              label('status'),
                              label('price'),
                              label('description'),
                              label('actions'),
                            ]}
                          />
                        </div>
                      </>
                    }
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
                    <OperationalQueueTable
                      locale={locale}
                      rows={rows}
                      caption={`${label(type)} · ${label('title')}`}
                      scrollLabel={`${label(type)} · ${label('title')}`}
                      nameHeader={label('productName')}
                      renderName={(row) => (
                        <>
                          {view === 'list' && !blocked ? (
                            <Link
                              to="/admin/catalogue/$category/$productId"
                              params={{ category: type, productId: row.id }}
                              search={routeSearch}
                              className="touch-action font-medium text-primary underline underline-offset-4 [overflow-wrap:anywhere]"
                            >
                              {title(row)}
                            </Link>
                          ) : (
                            <TextCell value={title(row)} />
                          )}
                          {row.systemKey && (
                            <span className="mt-1 block text-xs font-normal text-muted-foreground">
                              {label('systemKey')}: <TextCell value={row.systemKey} />
                            </span>
                          )}
                        </>
                      )}
                      fields={[
                        {
                          id: 'status',
                          label: label('status'),
                          render: (row) => (
                            <Badge variant={row.status === 'active' ? 'secondary' : 'outline'}>
                              {label(row.status)}
                            </Badge>
                          ),
                        },
                        {
                          id: 'price',
                          label: label('price'),
                          render: (row) =>
                            row.price === null ? (
                              <TextCell value={label('unset')} />
                            ) : (
                              <CurrencyCell amount={row.price} format={numbers.money} />
                            ),
                        },
                        {
                          id: 'description',
                          label: label('description'),
                          render: (row) => (
                            <span className="whitespace-pre-wrap">
                              <TextCell value={row.description?.[locale]} />
                            </span>
                          ),
                        },
                        ...(categoryOptions[type].length
                          ? [
                              {
                                id: 'categories',
                                label: label('categories'),
                                render: (row: Product) => (
                                  <TextCell value={row.categories.map(label).join(', ') || null} />
                                ),
                              },
                            ]
                          : []),
                        ...(type === 'electricity'
                          ? [
                              {
                                id: 'minimum',
                                label: label('minKwh'),
                                render: (row: Product) => (
                                  <TextCell
                                    value={
                                      row.electricityLimits
                                        ? numbers.irrDigits(row.electricityLimits.minKwh)
                                        : null
                                    }
                                  />
                                ),
                              },
                              {
                                id: 'maximum',
                                label: label('maxKwh'),
                                render: (row: Product) => (
                                  <TextCell
                                    value={
                                      row.electricityLimits
                                        ? row.electricityLimits.maxKwh === '0'
                                          ? label('noUpperLimit')
                                          : numbers.irrDigits(row.electricityLimits.maxKwh)
                                        : null
                                    }
                                  />
                                ),
                              },
                            ]
                          : []),
                      ]}
                      actionHeader={label('actions')}
                      renderActions={(row) =>
                        view === 'list' && !blocked ? (
                          <Link
                            to="/admin/catalogue/$category/$productId/edit"
                            params={{ category: type, productId: row.id }}
                            search={routeSearch}
                            className={buttonVariants({
                              variant: 'outline',
                              className: 'min-h-11',
                            })}
                            aria-label={`${label('edit')} ${title(row)}`}
                            data-table-action-tooltip={label('edit')}
                          >
                            <TableActionIcon icon={TablePencilIcon}>
                              {label('edit')}
                            </TableActionIcon>
                          </Link>
                        ) : (
                          <Button
                            variant="outline"
                            className="min-h-11"
                            aria-label={`${label('edit')} ${title(row)}`}
                            aria-current={editor === row.id ? 'page' : undefined}
                            disabled={blocked}
                            onClick={() => choose(row.id)}
                            data-table-action-tooltip={label('edit')}
                          >
                            <TableActionIcon icon={TablePencilIcon}>
                              {label('edit')}
                            </TableActionIcon>
                          </Button>
                        )
                      }
                      cardHeading="h2"
                      loading={state === 'loading'}
                      emptyMessage={label('empty')}
                      tableClassName="min-w-[60rem]"
                    />
                  </ListPage.Content>
                )}
                {listView && queries && (
                  <ListPage.Pagination
                    kind="cursor"
                    hasMore={hasNextPage && queries.query.page < 1_000_000}
                    loading={state !== 'ready' || blocked || uncertainCreate}
                    label={`${label('page')} ${numbers.number(queries.query.page)}`}
                    nextLabel={label('nextPage')}
                    onNext={() => queries.setQuery({ page: queries.query.page + 1 })}
                    previous={{
                      enabled: queries.query.page > 1,
                      label: label('previousPage'),
                      onClick: () => queries.setQuery({ page: queries.query.page - 1 }),
                    }}
                  />
                )}
              </ListPage>
            </div>
          ))}
      </div>
      {action && (
        <TeamActionDialog
          action={action}
          summary={
            <fieldset className="space-y-2 border-0 p-0" disabled={commandPending}>
              {uncertainCreate && <p role="alert">{label('unverifiedCreate')}</p>}
              <Button
                type="button"
                variant="outline"
                disabled={detailState === 'loading' || (readsCollection && state === 'loading')}
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
            </fieldset>
          }
          finalFocus={false}
          onDenied={denyAccess}
          onPendingChange={(pending) => setPendingAction(pending ? action : null)}
          onUnconfirmed={() => {
            setRequiredRead({ revision: revision + 1, editor });
            if (editor === 'new') setUncertainCreate(true);
          }}
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
            if (!matched) throw new Error('Invalid catalogue acknowledgement');
            if (view && (view === 'new' || view === 'edit' || view === 'price')) {
              const id = view === 'new' && validDetail(result) ? result.id : selected?.id;
              if (id) onRecordSaved?.(id);
            } else {
              choose(
                view ? editor : action.path.endsWith('/duplicate-policy') ? editor : null,
                'settled'
              );
            }
            setSaved(true);
            setRevision((value) => value + 1);
          })(commandVersion.current, detail, commandKind.current)}
        />
      )}
    </div>
  );
}
