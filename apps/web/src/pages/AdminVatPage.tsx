import { CalendarX as TableCalendarXIcon } from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import {
  LoadingStatus,
  Badge,
  Button,
  buttonVariants,
  DatePicker,
  datePickerAtTime,
  Input,
  Label,
  ListRefreshButton,
  ListPage,
  NativeSelect,
  DateCell,
  TextCell,
} from '@barghsa/ui';
import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import {
  RecordEditorActions,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { tWorkspace as settingsText } from '@barghsa/i18n/workspace-admin';
import { tVat } from '@barghsa/i18n/vat';
import { confirmationText } from '@barghsa/i18n/confirmation';
import {
  CHARGE_CATEGORIES,
  PRODUCT_OVERRIDE_CATEGORY,
  vatWindowStatus,
  type VatConfigDto,
  type VatProductOverrideDto,
} from '@barghsa/shared/finance';
import { useTimezone } from '../hooks/useTimezone.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useLocale } from '../hooks/useLocale.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  vatDefaults,
  vatBasisPoints,
  vatDraftInstant,
  type VatDraft,
  type VatFormContext,
} from '../lib/vat-form.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { toast } from '../lib/toast-api.js';
type Product = { id: string; title: Record<string, string>; type: string };
type Editor =
  | { kind: 'rate' }
  | { kind: 'override' }
  | { kind: 'endRate' | 'endOverride'; id: string; title: string };
type VatRecordKind = 'rates' | 'overrides';
type VatWorkspace =
  | { view: 'list' }
  | ({
      kind: VatRecordKind;
      showRecord: (id: string, replace?: boolean) => void;
      showList: () => void;
    } & ({ view: 'create' } | { view: 'detail' | 'end'; recordId: string }));
const categories = [...CHARGE_CATEGORIES, PRODUCT_OVERRIDE_CATEGORY];
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
function validWindow(value: unknown): value is Record<string, unknown> {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    instant(value.effectiveFrom) &&
    (value.effectiveUntil === null ||
      (instant(value.effectiveUntil) &&
        Date.parse(String(value.effectiveUntil)) > Date.parse(String(value.effectiveFrom)))) &&
    Number.isInteger(value.rateBasisPoints) &&
    Number(value.rateBasisPoints) >= 0 &&
    Number(value.rateBasisPoints) <= 10000
  );
}
function validRates(value: unknown): value is VatConfigDto[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        validWindow(row) &&
        typeof row.category === 'string' &&
        ['current', 'scheduled', 'expired'].includes(String(row.status))
    )
  );
}
function validOverrides(value: unknown): value is VatProductOverrideDto[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        validWindow(row) && typeof row.productId === 'string' && typeof row.vatConfigId === 'string'
    )
  );
}
function validProducts(value: unknown): value is Product[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        record(row) &&
        typeof row.id === 'string' &&
        typeof row.type === 'string' &&
        record(row.title) &&
        Object.values(row.title).every((title) => typeof title === 'string')
    )
  );
}
function financialBasis(row: VatConfigDto | VatProductOverrideDto | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    rate: row.rateBasisPoints,
    from: row.effectiveFrom,
    until: row.effectiveUntil,
    ...('productId' in row
      ? { product: row.productId, rateId: row.vatConfigId }
      : { category: row.category }),
  };
}
function commandBasis(
  command: TeamAction,
  rates: VatConfigDto[],
  overrides: VatProductOverrideDto[],
  products: Product[]
) {
  const base = '/api/admin/finance/vat',
    body = record(command.body) ? command.body : {};
  const sorted = (rows: (VatConfigDto | VatProductOverrideDto)[]) =>
    rows.map(financialBasis).sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  if (command.path === base)
    return JSON.stringify(sorted(rates.filter((row) => row.category === body.category)));
  if (command.path === `${base}/overrides`) {
    const product = products.find((row) => row.id === body.productId);
    return JSON.stringify({
      product: product ? { id: product.id, type: product.type } : null,
      rate: financialBasis(rates.find((row) => row.id === body.vatConfigId)),
      overrides: sorted(overrides.filter((row) => row.productId === body.productId)),
    });
  }
  const id = command.path.split('/').at(-2);
  if (command.path.includes('/overrides/')) {
    const row = overrides.find((v) => v.id === id);
    return JSON.stringify({
      row: financialBasis(row),
      rate: financialBasis(rates.find((v) => v.id === row?.vatConfigId)),
    });
  }
  return JSON.stringify(financialBasis(rates.find((v) => v.id === id)));
}
/** Accept a captured write or the service's documented same-open-version no-op. */
function matchesReceipt(
  command: TeamAction,
  result: unknown,
  rates: VatConfigDto[],
  overrides: VatProductOverrideDto[]
) {
  if (!record(command.body) || !validWindow(result)) return false;
  const body = command.body;
  const sameInstant = (a: unknown, b: unknown) =>
    instant(a) && instant(b) && Date.parse(String(a)) === Date.parse(String(b));
  const override = command.path.includes('/overrides');
  if (override ? !validOverrides([result]) : !validRates([result])) return false;
  if (command.path.endsWith('/end')) {
    const target = (override ? overrides : rates).find(
      (row) => row.id === command.path.split('/').at(-2)
    );
    if (
      !target ||
      result.id !== target.id ||
      result.rateBasisPoints !== target.rateBasisPoints ||
      !sameInstant(result.effectiveFrom, target.effectiveFrom) ||
      result.effectiveUntil === null
    )
      return false;
    if (
      'productId' in target
        ? result.productId !== target.productId || result.vatConfigId !== target.vatConfigId
        : result.category !== target.category
    )
      return false;
    return (
      body.effectiveUntil === undefined || sameInstant(result.effectiveUntil, body.effectiveUntil)
    );
  }
  if (
    override
      ? result.productId !== body.productId || result.vatConfigId !== body.vatConfigId
      : result.category !== body.category || result.rateBasisPoints !== body.rateBasisPoints
  )
    return false;
  if (
    override &&
    result.rateBasisPoints !== rates.find((row) => row.id === body.vatConfigId)?.rateBasisPoints
  )
    return false;
  if (result.effectiveUntil !== null) return false;
  const existing = (override ? overrides : rates).find((row) => row.id === result.id);
  const sameVersion =
    existing?.effectiveUntil === null &&
    JSON.stringify(financialBasis(existing)) ===
      JSON.stringify(financialBasis(result as unknown as VatConfigDto | VatProductOverrideDto));
  if (existing && !sameVersion) return false;
  return (
    body.effectiveFrom === undefined ||
    sameInstant(result.effectiveFrom, body.effectiveFrom) ||
    sameVersion
  );
}
export default function AdminVatPage({ workspace }: { workspace?: VatWorkspace } = {}) {
  const page = workspace && workspace.view !== 'list' ? workspace : null;
  const showDetail = page?.view === 'detail';
  const loadOverrides = page?.kind !== 'rates';
  const preference = useTimezone();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => tVat(`admin.vat.${key}`, locale);
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (editor) editorHeading.current?.focus();
  }, [editor]);
  const validationContext = useRef<VatFormContext>({
    kind: 'rate',
    categories,
    productIds: [],
    rateIds: [],
    resolveDate: () => undefined,
  });
  const messages: Record<keyof VatDraft, string> = {
    category: label('invalidCategory'),
    percent: label('invalidPercent'),
    productId: label('invalidProduct'),
    rateId: label('invalidRate'),
    scheduled: label('invalidDate'),
    date: label('invalidDate'),
    time: label('invalidTime'),
  };
  const draft = useWizardForm<VatDraft>(
    async () => {
      const context = validationContext.current;
      const { vatFormSchema } = await import('../lib/vat-form-schema.js');
      return vatFormSchema(context, messages, {
        basisPoints: vatBasisPoints,
        instant: vatDraftInstant,
      });
    },
    vatDefaults,
    label('validationUnavailable')
  );
  const [category, setCategory] = draft.field('category'),
    [percent, setPercent] = draft.field('percent'),
    [productId, setProductId] = draft.field('productId'),
    [rateId, setRateId] = draft.field('rateId'),
    [scheduled, setScheduled] = draft.field('scheduled'),
    [date, setDate] = draft.field('date'),
    [time, setTime] = draft.field('time');
  const [invalidDate, setInvalidDate] = useState(false);
  const applyServerErrors = useActionFieldErrors(draft.form, messages, label('invalid'));
  const invalidFocus = useRef<keyof VatDraft | null>(null);
  const locked = draft.pending || draft.form.formState.isSubmitting;
  const dateBinding = draft.bind('date');
  useEffect(() => {
    if (!locked && invalidFocus.current) {
      draft.form.setFocus(invalidFocus.current);
      invalidFocus.current = null;
    }
  }, [locked, draft.form]);
  function feedback(field: keyof VatDraft) {
    const message = draft.errors[field]?.message;
    return (
      <p
        id={draft.errorId(field)}
        role={message ? 'alert' : undefined}
        aria-hidden={message ? undefined : true}
        className={`text-sm text-destructive ${message ? '' : 'invisible line-clamp-1'}`}
      >
        {typeof message === 'string' ? message : messages[field]}
      </p>
    );
  }
  const [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false);
  const [pendingAction, setPendingAction] = useState<TeamAction | null>(null);
  const [requiredRead, setRequiredRead] = useState<{
    rates: number;
    overrides?: number;
    products?: number;
  } | null>(null);
  const generation = useRef(0),
    commandVersion = useRef(0),
    frozenBasis = useRef<string | null>(null);
  const [acceptedZone, setAcceptedZone] = useState<string | null>(null);
  const clearEditor = useCallback(() => {
    generation.current++;
    frozenBasis.current = null;
    setEditor(null);
    setAction(null);
    draft.form.reset(vatDefaults);
    invalidFocus.current = null;
    setInvalidDate(false);
  }, [draft.form.reset]);
  const clearWork = useCallback(() => {
    clearEditor();
    setSaved(false);
    setRequiredRead(null);
  }, [clearEditor]);
  const scope = useCatalogueScope(clearWork);
  const rateRead = useCatalogueResource(scope, '/api/admin/finance/vat', validRates);
  const overrideRead = useCatalogueResource(
    scope,
    loadOverrides ? '/api/admin/finance/vat/overrides' : null,
    validOverrides
  );
  const productRead = useCatalogueResource(
    scope,
    loadOverrides ? '/api/admin/finance/vat/products' : null,
    validProducts
  );
  const rates = rateRead.data ?? [],
    overrides = overrideRead.data ?? [],
    products = productRead.data ?? [];
  const zone =
    preference.status === 'ready' ? preference.timezone : (acceptedZone ?? preference.timezone);
  validationContext.current = {
    kind: editor?.kind ?? 'rate',
    categories,
    productIds: products.map((row) => row.id),
    rateIds: rates.map((row) => row.id),
    resolveDate: (value, hours, minutes) => datePickerAtTime(value, hours, minutes, zone),
  };
  const hasZone = preference.status === 'ready' || acceptedZone !== null;
  const rateDisabled =
    scope.denied ||
    requiredRead !== null ||
    rateRead.loading ||
    rateRead.error ||
    preference.status !== 'ready';
  const overrideDisabled = rateDisabled || overrideRead.loading || overrideRead.error;
  const choicesDisabled = overrideDisabled || productRead.loading || productRead.error;
  const commandDisabled = (kind: Editor['kind']) =>
    kind === 'override'
      ? choicesDisabled
      : kind === 'endOverride'
        ? overrideDisabled
        : rateDisabled;
  const productTitle = (id: string) => {
    const product = products.find((row) => row.id === id);
    return product?.title[locale] || product?.title.en || product?.title.fa || label('product');
  };
  const selectedRecord =
    page && page.view !== 'create'
      ? (page.kind === 'rates' ? rates : overrides).find((row) => row.id === page.recordId)
      : undefined;
  const selectedOverride = selectedRecord && 'productId' in selectedRecord ? selectedRecord : null;
  const selectedTitle = selectedOverride
    ? productTitle(selectedOverride.productId)
    : selectedRecord && 'category' in selectedRecord
      ? label(`category.${selectedRecord.category}`)
      : '';
  const commandType =
    page?.view === 'create'
      ? page.kind === 'rates'
        ? 'rate'
        : 'override'
      : page?.view === 'end'
        ? page.kind === 'rates'
          ? 'endRate'
          : 'endOverride'
        : null;
  const awaitingEditor = commandType !== null && commandDisabled(commandType);
  const selectedId = selectedRecord?.id;
  const canEnd = selectedRecord?.effectiveUntil === null;
  useEffect(() => {
    if (!commandType || awaitingEditor || editor || scope.denied) return;
    if (commandType === 'rate' || commandType === 'override') {
      setEditor({ kind: commandType });
    } else if (selectedId && canEnd && !productRead.loading) {
      setEditor({ kind: commandType, id: selectedId, title: selectedTitle });
    }
  }, [
    commandType,
    awaitingEditor,
    editor,
    scope.denied,
    selectedId,
    selectedTitle,
    canEnd,
    productRead.loading,
  ]);
  const work = useRef({
    editor,
    action,
    scheduled,
    rates,
    overrides,
    products,
    zone,
    disabled: true,
  });
  work.current = {
    editor,
    action,
    scheduled,
    rates,
    overrides,
    products,
    zone,
    disabled: editor === null || commandDisabled(editor.kind),
  };
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  useEffect(() => {
    if (preference.status !== 'ready') return;
    if (acceptedZone !== null && acceptedZone !== preference.timezone) {
      generation.current++;
      frozenBasis.current = null;
      setAction(null);
      if (work.current.scheduled) {
        setDate(undefined);
        draft.form.clearErrors(['date', 'time']);
        setInvalidDate(true);
      }
    }
    setAcceptedZone(preference.timezone);
  }, [preference.status, preference.timezone, acceptedZone]);
  useEffect(() => {
    const current = work.current;
    if (current.editor && 'id' in current.editor) {
      const ending = current.editor;
      const rows = ending.kind === 'endRate' ? rateRead.data : overrideRead.data;
      if (rows && !rows.some((row) => row.id === ending.id && row.effectiveUntil === null)) {
        clearEditor();
        return;
      }
    }
    if (
      current.action &&
      frozenBasis.current !== null &&
      commandBasis(current.action, current.rates, current.overrides, current.products) !==
        frozenBasis.current
    ) {
      generation.current++;
      frozenBasis.current = null;
      setAction(null);
    }
  }, [rateRead.data, overrideRead.data, productRead.data, clearEditor]);
  useEffect(() => {
    if (
      !requiredRead ||
      rateRead.loading ||
      rateRead.error ||
      (rateRead.readAttempt ?? -1) < requiredRead.rates ||
      (requiredRead.overrides !== undefined &&
        (overrideRead.loading ||
          overrideRead.error ||
          (overrideRead.readAttempt ?? -1) < requiredRead.overrides)) ||
      (requiredRead.products !== undefined &&
        (productRead.loading ||
          productRead.error ||
          (productRead.readAttempt ?? -1) < requiredRead.products))
    )
      return;
    generation.current++;
    frozenBasis.current = null;
    setAction(null);
    setRequiredRead(null);
  }, [requiredRead, rateRead, overrideRead, productRead]);
  function refresh() {
    preference.retry();
    if (scope.denied) scope.recover();
    else {
      rateRead.retry();
      if (loadOverrides) {
        overrideRead.retry();
        productRead.retry();
      }
    }
  }
  const recovery = (
    <fieldset
      className="space-y-2 border-0 p-0"
      disabled={action !== null && action === pendingAction}
    >
      <Button
        type="button"
        variant="outline"
        disabled={
          rateRead.loading ||
          overrideRead.loading ||
          productRead.loading ||
          preference.status === 'loading'
        }
        onClick={refresh}
      >
        {label('refresh')}
      </Button>
      {rateRead.error && (
        <div role="alert">
          <p>{label('ratesError')}</p>
          <Button type="button" onClick={rateRead.retry}>
            {label('ratesRetry')}
          </Button>
        </div>
      )}
      {overrideRead.error && (
        <div role="alert">
          <p>{label('overridesError')}</p>
          <Button type="button" onClick={overrideRead.retry}>
            {label('overridesRetry')}
          </Button>
        </div>
      )}
      {productRead.error && (
        <div role="alert">
          <p>{label('productsError')}</p>
          <Button type="button" onClick={productRead.retry}>
            {label('productsRetry')}
          </Button>
        </div>
      )}
      {preference.status === 'loading' && <LoadingStatus>{label('timezoneLoading')}</LoadingStatus>}
      {preference.status === 'error' && (
        <div role="alert">
          <p>{label('timezoneError')}</p>
          <Button type="button" onClick={preference.retry}>
            {label('timezoneRetry')}
          </Button>
        </div>
      )}
    </fieldset>
  );
  const dateText = (value: string) =>
    hasZone ? new Date(value).toLocaleString(locale, { timeZone: zone }) : label('timezoneLoading');
  function overrideStatus(row: VatProductOverrideDto) {
    const rate = rates.find((value) => value.id === row.vatConfigId);
    if (!rate) return 'expired';
    const from = Math.max(Date.parse(row.effectiveFrom), Date.parse(rate.effectiveFrom));
    const until = Math.min(
      row.effectiveUntil ? Date.parse(row.effectiveUntil) : Infinity,
      rate.effectiveUntil ? Date.parse(rate.effectiveUntil) : Infinity
    );
    if (until <= from) return 'expired';
    return vatWindowStatus(
      new Date(from).toISOString(),
      Number.isFinite(until) ? new Date(until).toISOString() : null
    );
  }
  function open(next: Editor) {
    if (commandDisabled(next.kind) || draft.isPending() || action) return;
    clearEditor();
    setSaved(false);
    setEditor(next);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || commandDisabled(editor.kind) || draft.isPending() || action) return;
    const version = generation.current;
    const context = validationContext.current;
    const selected = editor;
    draft.setValidationPending(true);
    setSaved(false);
    try {
      await draft.form.handleSubmit(
        async (values) => {
          if (
            version !== generation.current ||
            work.current.editor !== selected ||
            work.current.disabled ||
            work.current.zone !== zone
          )
            return;
          const instant = values.scheduled
            ? (vatDraftInstant(values, context) ?? undefined)
            : undefined;
          const ending = editor.kind === 'endRate' || editor.kind === 'endOverride';
          const path =
            editor.kind === 'rate'
              ? ''
              : editor.kind === 'override'
                ? '/overrides'
                : editor.kind === 'endRate'
                  ? `/${editor.id}/end`
                  : `/overrides/${editor.id}/end`;
          const body = ending
            ? { ...(instant ? { effectiveUntil: instant } : {}) }
            : editor.kind === 'rate'
              ? {
                  category: values.category,
                  rateBasisPoints: vatBasisPoints(values.percent)!,
                  ...(instant ? { effectiveFrom: instant } : {}),
                }
              : {
                  productId: values.productId,
                  vatConfigId: values.rateId,
                  ...(instant ? { effectiveFrom: instant } : {}),
                };
          setSaved(false);
          const command: TeamAction = {
            path: `/api/admin/finance/vat${path}`,
            method: 'POST',
            ...(ending ? { risk: 'destructive' as const } : {}),
            title: label(ending ? 'end' : 'save'),
            description: label(ending ? 'confirmEnd' : 'confirmSave'),
            body,
            forbiddenMessage: label('denied'),
            conflictMessage: label('conflict'),
            errorMessages: {
              'VALIDATION:PARSE:ZOD_ERROR': label('invalid'),
              VAT_RATE_INVALID: label('invalid'),
              VAT_RATE_INVALID_EFFECTIVE_FROM: label('invalidWindow'),
              VAT_RATE_INVALID_EFFECTIVE_UNTIL: label('invalidWindow'),
              VAT_OVERRIDE_INVALID_EFFECTIVE_FROM: label('invalidWindow'),
              VAT_OVERRIDE_INVALID_EFFECTIVE_UNTIL: label('invalidWindow'),
              VAT_OVERRIDE_CONFIG_INACTIVE: label('inactiveRate'),
              VAT_REFERENCE_MISSING: label('missing'),
            },
          };
          const basis = commandBasis(command, rates, overrides, products);
          if (
            basis !==
            commandBasis(command, work.current.rates, work.current.overrides, work.current.products)
          )
            return;
          commandVersion.current = version;
          frozenBasis.current = basis;
          setAction(command);
        },
        (errors) => {
          invalidFocus.current =
            (Object.keys(errors).find((key) => key in messages) as keyof VatDraft | undefined) ??
            null;
        }
      )();
    } finally {
      draft.setValidationPending(false);
    }
  }
  const windowFields = [
    {
      id: 'percent',
      label: label('percent'),
      render: (row: VatConfigDto | VatProductOverrideDto) =>
        numbers.percent(row.rateBasisPoints / 10000),
    },
    {
      id: 'from',
      label: label('from'),
      render: (row: VatConfigDto | VatProductOverrideDto) => (
        <DateCell value={row.effectiveFrom} format={() => dateText(row.effectiveFrom)} />
      ),
    },
    {
      id: 'until',
      label: label('until'),
      render: (row: VatConfigDto | VatProductOverrideDto) =>
        row.effectiveUntil ? (
          <DateCell value={row.effectiveUntil} format={(value) => dateText(String(value))} />
        ) : (
          label('openEnded')
        ),
    },
    {
      id: 'status',
      label: label('status'),
      render: (row: VatConfigDto | VatProductOverrideDto) =>
        label(`status.${'productId' in row ? overrideStatus(row) : row.status}`),
    },
  ];
  const recordKind = page?.kind ?? 'rates';
  const linkedRate =
    selectedOverride && rates.find((row) => row.id === selectedOverride.vatConfigId);
  const scopeHistory = !selectedRecord
    ? []
    : selectedOverride
      ? overrides.filter(
          (row) => row.productId === selectedOverride.productId && row.id !== selectedRecord.id
        )
      : rates.filter(
          (row) =>
            'category' in selectedRecord &&
            row.category === selectedRecord.category &&
            row.id !== selectedRecord.id
        );
  const href = (kind: VatRecordKind, recordId: string, action?: 'end') => ({
    to: '/admin/vat/$kind/$recordId/{-$action}' as const,
    params: { kind, recordId, action },
  });
  const readError = page && (rateRead.error || (page.kind === 'overrides' && overrideRead.error));
  const readPending =
    page && (rateRead.loading || (page.kind === 'overrides' && overrideRead.loading));
  const ending =
    editor && 'id' in editor
      ? editor.kind === 'endRate'
        ? rates.find((row) => row.id === editor.id)
        : overrides.find((row) => row.id === editor.id)
      : undefined;
  const scopeRate = rates.find(
    (row) =>
      row.category === category &&
      vatWindowStatus(row.effectiveFrom, row.effectiveUntil) === 'current'
  );
  const scopeOverride = overrides.find(
    (row) => row.productId === productId && overrideStatus(row) === 'current'
  );
  const productCategory = products.find((row) => row.id === productId)?.type;
  const categoryFallback = rates.find(
    (row) =>
      row.category === productCategory &&
      vatWindowStatus(row.effectiveFrom, row.effectiveUntil) === 'current'
  );
  const proposedRate = rates.find((row) => row.id === rateId);
  const referenceRate =
    ending ?? (editor?.kind === 'rate' ? scopeRate : (scopeOverride ?? categoryFallback));
  const referencePercent =
    referenceRate?.rateBasisPoints ?? (editor?.kind === 'override' ? 0 : null);
  const draftPercent =
    editor?.kind === 'rate' ? vatBasisPoints(percent) : proposedRate?.rateBasisPoints;
  const proposedInstant = scheduled
    ? vatDraftInstant(draft.form.getValues(), validationContext.current)
    : undefined;
  const proposedDate = scheduled
    ? proposedInstant
      ? dateText(proposedInstant)
      : label('chooseDate')
    : label('afterConfirmation');
  const percentText = (basis: number) => numbers.percent(basis / 10000);
  const endingAction =
    recordKind === 'overrides' || editor?.kind === 'endOverride' ? 'endOverride' : 'end';
  const endingEditor = editor?.kind === 'endRate' || editor?.kind === 'endOverride';
  const dateLabel = label(endingEditor ? 'endDate' : 'date');
  const formPage = page?.view === 'create' || page?.view === 'end';
  const pageTitle = !page
    ? label('title')
    : page.view === 'create'
      ? label(recordKind === 'rates' ? 'addRate' : 'addOverride')
      : page.view === 'end'
        ? label(endingAction)
        : selectedTitle || label('rate');
  return (
    <div
      className={`mx-auto flex w-full min-w-0 flex-col ${formPage ? 'max-w-3xl gap-4 py-1' : 'max-w-5xl gap-6 p-4 md:p-8'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {page && (
        <nav aria-label={label('title')} className="flex flex-wrap gap-3 text-sm font-medium">
          <Link to="/admin/vat" className="text-primary hover:underline">
            {label('title')}
          </Link>
          {page.view === 'end' && (
            <Link {...href(page.kind, page.recordId)} className="text-primary hover:underline">
              {label('viewRecord')}
            </Link>
          )}
        </nav>
      )}
      <header
        className={`flex items-start justify-between gap-3 ${formPage ? '' : 'flex-wrap border-b pb-5'}`}
      >
        <div className="min-w-0 max-w-2xl space-y-1">
          <h1
            ref={formPage ? editorHeading : undefined}
            tabIndex={formPage ? -1 : undefined}
            className="break-words text-2xl font-semibold focus-visible:outline-hidden!"
          >
            {pageTitle}
          </h1>
          {!page && <p className="text-sm text-muted-foreground">{label('precedence')}</p>}
          {showDetail && selectedRecord && (
            <Badge variant="outline">
              {label(
                `status.${'productId' in selectedRecord ? overrideStatus(selectedRecord) : selectedRecord.status}`
              )}
            </Badge>
          )}
          {preference.status === 'ready' && (
            <p className="text-sm text-muted-foreground">
              {label('timezone')}: <bdi>{zone}</bdi>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showDetail && selectedRecord && canEnd && (
            <Link
              {...href(recordKind, selectedRecord.id, 'end')}
              className={buttonVariants({ className: 'min-h-11' })}
              disabled={recordKind === 'rates' ? rateDisabled : overrideDisabled}
            >
              {label(endingAction)}
            </Link>
          )}
          <ListRefreshButton
            label={label('refresh')}
            refreshing={
              rateRead.loading ||
              overrideRead.loading ||
              productRead.loading ||
              preference.status === 'loading'
            }
            onClick={refresh}
          />
        </div>
      </header>
      {requiredRead && !action && <p role="alert">{confirmationText('unconfirmed', locale)}</p>}
      {scope.denied && <p role="alert">{label('denied')}</p>}
      {!scope.denied && (
        <>
          <CommandFeedback message={saved ? label('saved') : null} />
          {preference.status === 'loading' && (
            <LoadingStatus>{label('timezoneLoading')}</LoadingStatus>
          )}
          {preference.status === 'error' && (
            <div role="alert">
              <p>{label('timezoneError')}</p>
              <Button onClick={preference.retry}>{label('timezoneRetry')}</Button>
            </div>
          )}
          {productRead.loading && <LoadingStatus>{label('productsLoading')}</LoadingStatus>}
          {productRead.error && (
            <div role="alert">
              <p>{label('productsError')}</p>
              <Button onClick={productRead.retry}>{label('productsRetry')}</Button>
            </div>
          )}
          {!page && (
            <div className="flex flex-wrap gap-2">
              {workspace ? (
                <>
                  <Link
                    {...href('rates', 'new')}
                    disabled={rateDisabled}
                    className={buttonVariants({ className: 'min-h-11' })}
                  >
                    {label('addRate')}
                  </Link>
                  <Link
                    {...href('overrides', 'new')}
                    disabled={choicesDisabled}
                    className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                  >
                    {label('addOverride')}
                  </Link>
                </>
              ) : (
                <>
                  <Button
                    disabled={rateDisabled || locked || action !== null}
                    onClick={() => open({ kind: 'rate' })}
                  >
                    {label('addRate')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={choicesDisabled || locked || action !== null}
                    onClick={() => open({ kind: 'override' })}
                  >
                    {label('addOverride')}
                  </Button>
                </>
              )}
            </div>
          )}
          {readPending && <LoadingStatus>{label('loading')}</LoadingStatus>}
          {readError && (
            <div role="alert" className="space-y-2">
              <p>{label(rateRead.error ? 'ratesError' : 'overridesError')}</p>
              <Button onClick={rateRead.error ? rateRead.retry : overrideRead.retry}>
                {label(rateRead.error ? 'ratesRetry' : 'overridesRetry')}
              </Button>
            </div>
          )}
          {page && page.view !== 'create' && !readPending && !readError && !selectedRecord && (
            <p role="alert">{label('missingRecord')}</p>
          )}
          {page?.view === 'end' && selectedRecord && !canEnd && <p>{label('alreadyEnded')}</p>}
          {showDetail && selectedRecord && (
            <>
              <section
                aria-label={label('recordWindow')}
                className="rounded-lg border bg-card p-4 md:p-6"
              >
                <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                  {windowFields.map((field) => (
                    <div key={field.id}>
                      <dt className="text-sm text-muted-foreground">{field.label}</dt>
                      <dd className="mt-1 font-medium">{field.render(selectedRecord)}</dd>
                    </div>
                  ))}
                  {linkedRate && (
                    <div>
                      <dt className="text-sm text-muted-foreground">{label('rate')}</dt>
                      <dd className="mt-1">
                        <Link
                          {...href('rates', linkedRate.id)}
                          className="font-medium text-primary hover:underline"
                        >
                          {label(`category.${linkedRate.category}`)} ·{' '}
                          {percentText(linkedRate.rateBasisPoints)}
                        </Link>
                      </dd>
                    </div>
                  )}
                </dl>
              </section>
              {scopeHistory.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-lg font-semibold">{label('scopeHistory')}</h2>
                  <ul className="divide-y rounded-lg border bg-card">
                    {scopeHistory.map((row) => (
                      <li key={row.id}>
                        <Link
                          {...href(recordKind, row.id)}
                          className="flex flex-wrap items-start justify-between gap-3 p-4 hover:bg-muted"
                        >
                          <div>
                            <p className="font-medium tabular-nums">
                              {percentText(row.rateBasisPoints)}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {windowFields[1]!.render(row)} · {windowFields[2]!.render(row)}
                            </p>
                          </div>
                          <Badge variant="outline">{windowFields[3]!.render(row)}</Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
          {editor && (
            <form
              aria-label={label('editor')}
              noValidate
              onSubmit={submit}
              aria-busy={locked || undefined}
              className={recordEditorSurface}
            >
              <fieldset disabled={locked || action !== null} className="m-0 min-w-0 border-0 p-0">
                <div className="space-y-4 px-4 py-4 sm:px-6">
                  {!formPage && (
                    <h2
                      ref={editorHeading}
                      tabIndex={-1}
                      className="text-base font-semibold focus-visible:outline-hidden!"
                    >
                      {'title' in editor
                        ? editor.title
                        : label(editor.kind === 'rate' ? 'addRate' : 'addOverride')}
                    </h2>
                  )}
                  {editor.kind === 'rate' && (
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:gap-5">
                      <div className={`${recordEditorField} flex-1`}>
                        <Label htmlFor="vat-category">{label('category')}</Label>
                        <NativeSelect
                          id="vat-category"
                          aria-required="true"
                          {...draft.bind('category')}
                          className="w-full"
                          value={category}
                          onChange={(event) => setCategory(event.target.value)}
                        >
                          {categories.map((value) => (
                            <option key={value} value={value}>
                              {label(`category.${value}`)}
                            </option>
                          ))}
                        </NativeSelect>
                        {feedback('category')}
                      </div>
                      <div className={`${recordEditorField} sm:w-40`}>
                        <Label htmlFor="vat-percent">{label('percent')}</Label>
                        <Input
                          id="vat-percent"
                          aria-required="true"
                          {...draft.bind('percent')}
                          type="text"
                          inputMode="decimal"
                          placeholder="10.5"
                          dir="ltr"
                          value={percent}
                          onChange={(event) => setPercent(event.target.value)}
                        />
                        {feedback('percent')}
                      </div>
                    </div>
                  )}
                  {editor.kind === 'override' && (
                    <>
                      <p id="vat-override-help" className="text-sm text-muted-foreground">
                        {label('overrideHelp')}
                      </p>
                      <div className={`${recordEditorGrid} gap-y-3`}>
                        <div className={recordEditorField}>
                          <Label htmlFor="vat-product">{label('product')}</Label>
                          <NativeSelect
                            id="vat-product"
                            {...draft.bind('productId')}
                            className="w-full"
                            required
                            aria-required="true"
                            value={productId}
                            onChange={(event) => setProductId(event.target.value)}
                          >
                            <option value="">{label('chooseProduct')}</option>
                            {productId && !products.some((row) => row.id === productId) && (
                              <option value={productId}>
                                {label('unavailable')} ({productId})
                              </option>
                            )}
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {productTitle(product.id)}
                              </option>
                            ))}
                          </NativeSelect>
                          {feedback('productId')}
                        </div>
                        <div className={recordEditorField}>
                          <Label htmlFor="vat-rate">{label('rate')}</Label>
                          <NativeSelect
                            id="vat-rate"
                            {...draft.bind('rateId')}
                            aria-describedby={`vat-override-help ${draft.bind('rateId')['aria-describedby'] ?? ''}`}
                            className="w-full"
                            required
                            aria-required="true"
                            value={rateId}
                            onChange={(event) => setRateId(event.target.value)}
                          >
                            <option value="">{label('chooseRate')}</option>
                            {rateId && !rates.some((row) => row.id === rateId) && (
                              <option value={rateId}>
                                {label('unavailable')} ({rateId})
                              </option>
                            )}
                            {rates.map((rate) => (
                              <option key={rate.id} value={rate.id}>
                                {label(`category.${rate.category}`)} ·{' '}
                                {numbers.percent(rate.rateBasisPoints / 10000)} ·{' '}
                                {dateText(rate.effectiveFrom)}
                              </option>
                            ))}
                          </NativeSelect>
                          {feedback('rateId')}
                        </div>
                      </div>
                    </>
                  )}
                  {formPage && 'title' in editor && (
                    <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
                      <dt className="text-muted-foreground">{label('scope')}</dt>
                      <dd className="min-w-0 break-words font-medium">{editor.title}</dd>
                    </dl>
                  )}
                  <div className="space-y-2 border-t pt-2">
                    <label className="touch-label flex cursor-pointer items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={scheduled}
                        onChange={(event) => {
                          setScheduled(event.target.checked);
                          setInvalidDate(false);
                        }}
                      />
                      {label(endingEditor ? 'scheduleEnd' : 'schedule')}
                    </label>
                    {!scheduled && (
                      <p className="text-sm text-muted-foreground">{label('immediate')}</p>
                    )}
                    {scheduled && (
                      <div className="flex min-w-0 flex-col gap-3 rounded-lg bg-muted/45 p-3 sm:flex-row sm:gap-5">
                        <div className={`${recordEditorField} flex-1`}>
                          <Label htmlFor="vat-date">{dateLabel}</Label>
                          <DatePicker
                            id="vat-date"
                            className="min-h-11 min-w-0"
                            onBlur={dateBinding.onBlur}
                            triggerProps={{
                              ref: dateBinding.ref,
                              name: dateBinding.name,
                              'aria-required': true,
                              'aria-invalid': invalidDate || dateBinding['aria-invalid'],
                              'aria-describedby': invalidDate
                                ? 'vat-zone-date-error'
                                : dateBinding['aria-describedby'],
                            }}
                            label={dateLabel}
                            placeholder={label('chooseDate')}
                            locale={locale}
                            timezone={zone}
                            {...(date ? { value: date } : {})}
                            onChange={(value) => {
                              setDate(value);
                              setInvalidDate(false);
                            }}
                          />
                          {feedback('date')}
                        </div>
                        <div className={`${recordEditorField} sm:w-40`}>
                          <Label htmlFor="vat-time">
                            {label(endingEditor ? 'endTime' : 'time')}
                          </Label>
                          <Input
                            id="vat-time"
                            {...draft.bind('time')}
                            type="time"
                            dir="ltr"
                            required
                            aria-required="true"
                            value={time}
                            onChange={(event) => {
                              setTime(event.target.value);
                              setInvalidDate(false);
                            }}
                          />
                          {feedback('time')}
                        </div>
                      </div>
                    )}
                    {invalidDate && (
                      <p
                        id="vat-zone-date-error"
                        role="alert"
                        className="text-sm font-medium text-destructive"
                      >
                        {label('invalidDate')}
                      </p>
                    )}
                  </div>
                  {(editor.kind !== 'override' || (productId && rateId)) && (
                    <section
                      aria-label={settingsText('admin.settings.comparison', locale)}
                      data-testid="config-preview"
                    >
                      <dl className="grid grid-cols-2 overflow-hidden rounded-lg border text-sm">
                        <div className="min-w-0 space-y-0.5 px-3 py-2.5">
                          <dt className="text-muted-foreground">
                            {label(ending ? 'endingRate' : 'currentRate')}
                          </dt>
                          <dd className="break-words font-semibold tabular-nums">
                            {referencePercent === null
                              ? settingsText('admin.settings.none', locale)
                              : percentText(referencePercent)}
                          </dd>
                          {referenceRate && (
                            <dd className="break-words text-muted-foreground">
                              {dateText(referenceRate.effectiveFrom)}
                            </dd>
                          )}
                        </div>
                        <div className="min-w-0 space-y-0.5 border-s bg-primary/5 px-3 py-2.5">
                          <dt className="text-muted-foreground">
                            {label(ending ? 'ends' : 'proposedRate')}
                          </dt>
                          <dd className="break-words font-semibold tabular-nums">
                            {ending
                              ? proposedDate
                              : draftPercent == null
                                ? label(editor.kind === 'rate' ? 'invalid' : 'chooseRate')
                                : percentText(draftPercent)}
                          </dd>
                          {!ending && (
                            <dd className="break-words text-muted-foreground">{proposedDate}</dd>
                          )}
                        </div>
                      </dl>
                    </section>
                  )}
                  {draft.errors.root && (
                    <p role="alert" className="text-sm font-medium text-destructive">
                      {draft.errors.root.validation?.message ?? draft.errors.root.message}
                    </p>
                  )}
                </div>
                <RecordEditorActions>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      clearEditor();
                      if (page?.view === 'end') page.showRecord(page.recordId);
                      else page?.showList();
                    }}
                  >
                    {label('cancel')}
                  </Button>
                  <Button type="submit" disabled={commandDisabled(editor.kind)}>
                    {locked && (
                      <span
                        aria-hidden="true"
                        className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                      />
                    )}
                    {label(
                      locked
                        ? 'working'
                        : editor.kind === 'endRate' || editor.kind === 'endOverride'
                          ? 'end'
                          : 'save'
                    )}
                  </Button>
                </RecordEditorActions>
              </fieldset>
            </form>
          )}
          {!page && (
            <>
              <section>
                <h2 className="text-xl font-semibold">{label('rates')}</h2>
                <ListPage>
                  <ListPage.Content
                    loading={rateRead.loading}
                    error={rateRead.error}
                    empty={!rates.length}
                    retainContent={rates.length > 0}
                    loadingView={<LoadingStatus>{label('loading')}</LoadingStatus>}
                    emptyView={<p>{label('empty')}</p>}
                    errorView={
                      <div role="alert">
                        <p>{label('ratesError')}</p>
                        <Button onClick={rateRead.retry}>{label('ratesRetry')}</Button>
                      </div>
                    }
                  >
                    {rates.length > 0 && (
                      <OperationalQueueTable
                        locale={locale}
                        rows={rates}
                        caption={label('rates')}
                        scrollLabel={label('rates')}
                        nameHeader={label('category')}
                        renderName={(rate) =>
                          workspace ? (
                            <Link
                              {...href('rates', rate.id)}
                              className="font-medium text-primary hover:underline"
                            >
                              {label(`category.${rate.category}`)}
                            </Link>
                          ) : (
                            <TextCell value={label(`category.${rate.category}`)} />
                          )
                        }
                        fields={windowFields}
                        actionHeader={label('actions')}
                        renderActions={(rate) => (
                          <>
                            {rate.effectiveUntil === null &&
                              (workspace ? (
                                <Link
                                  {...href('rates', rate.id, 'end')}
                                  className={buttonVariants({
                                    variant: 'outline',
                                    className: 'min-h-11',
                                  })}
                                  aria-label={`${label('end')} ${label(`category.${rate.category}`)}`}
                                  disabled={rateDisabled}
                                  data-table-action-tooltip={label('end')}
                                >
                                  <TableActionIcon icon={TableCalendarXIcon}>
                                    {label('end')}
                                  </TableActionIcon>
                                </Link>
                              ) : (
                                <Button
                                  variant="outline"
                                  aria-label={`${label('end')} ${label(`category.${rate.category}`)}`}
                                  disabled={rateDisabled || locked || action !== null}
                                  onClick={() =>
                                    open({
                                      kind: 'endRate',
                                      id: rate.id,
                                      title: label(`category.${rate.category}`),
                                    })
                                  }
                                  data-table-action-tooltip={label('end')}
                                >
                                  <TableActionIcon icon={TableCalendarXIcon}>
                                    {label('end')}
                                  </TableActionIcon>
                                </Button>
                              ))}
                          </>
                        )}
                        loading={rateRead.loading}
                        emptyMessage={label('empty')}
                      />
                    )}
                  </ListPage.Content>
                </ListPage>
              </section>
              <section>
                <h2 className="text-xl font-semibold">{label('overrides')}</h2>
                <ListPage>
                  <ListPage.Content
                    loading={overrideRead.loading}
                    error={overrideRead.error}
                    empty={!overrides.length}
                    retainContent={overrides.length > 0}
                    loadingView={<LoadingStatus>{label('loading')}</LoadingStatus>}
                    emptyView={<p>{label('empty')}</p>}
                    errorView={
                      <div role="alert">
                        <p>{label('overridesError')}</p>
                        <Button onClick={overrideRead.retry}>{label('overridesRetry')}</Button>
                      </div>
                    }
                  >
                    {overrides.length > 0 && (
                      <OperationalQueueTable
                        locale={locale}
                        rows={overrides}
                        caption={label('overrides')}
                        scrollLabel={label('overrides')}
                        nameHeader={label('product')}
                        renderName={(row) =>
                          workspace ? (
                            <Link
                              {...href('overrides', row.id)}
                              className="font-medium text-primary hover:underline"
                            >
                              {productTitle(row.productId)}
                            </Link>
                          ) : (
                            <TextCell value={productTitle(row.productId)} />
                          )
                        }
                        fields={windowFields}
                        actionHeader={label('actions')}
                        renderActions={(row) => (
                          <>
                            {row.effectiveUntil === null &&
                              (workspace ? (
                                <Link
                                  {...href('overrides', row.id, 'end')}
                                  className={buttonVariants({
                                    variant: 'outline',
                                    className: 'min-h-11',
                                  })}
                                  aria-label={`${label('endOverride')} ${productTitle(row.productId)}`}
                                  disabled={overrideDisabled}
                                  data-table-action-tooltip={label('endOverride')}
                                >
                                  <TableActionIcon icon={TableCalendarXIcon}>
                                    {label('endOverride')}
                                  </TableActionIcon>
                                </Link>
                              ) : (
                                <Button
                                  variant="outline"
                                  aria-label={`${label('endOverride')} ${productTitle(row.productId)}`}
                                  disabled={overrideDisabled || locked || action !== null}
                                  onClick={() =>
                                    open({
                                      kind: 'endOverride',
                                      id: row.id,
                                      title: productTitle(row.productId),
                                    })
                                  }
                                  data-table-action-tooltip={label('endOverride')}
                                >
                                  <TableActionIcon icon={TableCalendarXIcon}>
                                    {label('endOverride')}
                                  </TableActionIcon>
                                </Button>
                              ))}
                          </>
                        )}
                        loading={overrideRead.loading}
                        emptyMessage={label('empty')}
                      />
                    )}
                  </ListPage.Content>
                </ListPage>
              </section>
            </>
          )}
        </>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          summary={
            <div className="space-y-4">
              {editor && (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">{label('scope')}</dt>
                    <dd>
                      {'title' in editor
                        ? editor.title
                        : editor.kind === 'rate'
                          ? label(`category.${category}`)
                          : productTitle(productId)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {ending ? label('until') : label('from')}
                    </dt>
                    <dd>{proposedDate}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{label('percent')}</dt>
                    <dd>
                      {percentText(
                        ending?.rateBasisPoints ??
                          proposedRate?.rateBasisPoints ??
                          vatBasisPoints(percent) ??
                          0
                      )}
                    </dd>
                  </div>
                </dl>
              )}
              {recovery}
            </div>
          }
          finalFocus={false}
          onDenied={() => scope.deny()}
          onPendingChange={(pending) => setPendingAction(pending ? action : null)}
          onUnconfirmed={() =>
            setRequiredRead({
              rates: rateRead.nextReadAttempt(),
              ...(editor?.kind === 'override' || editor?.kind === 'endOverride'
                ? { overrides: overrideRead.nextReadAttempt() }
                : {}),
              ...(editor?.kind === 'override' ? { products: productRead.nextReadAttempt() } : {}),
            })
          }
          onValidationError={(fields) => {
            const allowed = [
              ...(editor?.kind === 'rate'
                ? ['category', 'percent']
                : editor?.kind === 'override'
                  ? ['productId', 'rateId']
                  : []),
              ...(scheduled ? ['date', 'time'] : []),
            ];
            return (
              commandVersion.current === generation.current &&
              fields.every((field) => typeof field === 'string' && allowed.includes(field)) &&
              applyServerErrors(fields)
            );
          }}
          confirmationDisabled={editor === null || commandDisabled(editor.kind)}
          onClose={() => {
            generation.current++;
            frozenBasis.current = null;
            setAction(null);
          }}
          onSuccess={((version) => async (result) => {
            if (version !== generation.current) return;
            if (
              !matchesReceipt(action, result, rates, overrides) ||
              !validWindow(result) ||
              typeof result.id !== 'string'
            )
              throw new Error('Invalid VAT acknowledgement');
            if (page) {
              setAction(null);
              toast.success(label('saved'));
              page.showRecord(result.id, true);
              return;
            }
            clearEditor();
            setSaved(true);
            rateRead.retry();
            overrideRead.retry();
          })(commandVersion.current)}
        />
      )}
    </div>
  );
}
