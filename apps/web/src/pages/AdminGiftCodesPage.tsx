import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
} from '../components/RecordEditorLayout.js';
import {
  Ban as TableBanIcon,
  CheckCircle as TableCheckCircleIcon,
  Pencil as TablePencilIcon,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { Link } from '@tanstack/react-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  LoadingStatus,
  Badge,
  Button,
  buttonVariants,
  DateCell,
  TextCell,
  DatePicker,
  Label,
  ListPage,
  ListRefreshButton,
  ListSearchInput,
  NativeSelect,
} from '@barghsa/ui';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import { tGift } from '@barghsa/i18n/gifts';
import { GIFT_CODE_CATEGORIES, type GiftCodeDto } from '@barghsa/shared/promotions';
import { useTimezone } from '../hooks/useTimezone.js';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { GiftProfilePicker } from '../components/GiftProfilePicker.js';
import { RecordTimeInput } from '../components/RecordTimeInput.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useGiftCodeCatalogue } from '../hooks/useGiftCodeCatalogue.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { giftFilter } from '../lib/gift-list-query.js';
import { toast } from '../lib/toast-api.js';
import {
  Form,
  FormInput,
  FormField,
  FormLabel,
  FormItem,
  FormControl,
  FormMessage,
  FormSubmit,
  useZodForm,
} from '@barghsa/ui/form';
import {
  giftDraftFrom as draftFrom,
  giftCapSubtotal,
  giftDraftErrors,
  giftDraftPayload,
  giftFieldNames,
  type GiftDraft as Draft,
} from '../lib/gift-code-form.js';
import {
  giftCodeBasis,
  isGiftCodeStats,
  matchesGiftReceipt,
  type GiftCodeStats,
} from '../lib/gift-code-catalogue.js';
type GiftReview = TeamAction & {
  epoch: number;
  id: string | null;
  basis: string;
  queryScope: string;
};
type GiftWorkspace =
  | { view: 'list'; search: Record<string, string> }
  | ({
      search: Record<string, string>;
      goToRecord: (id: string, replace?: boolean) => void;
      goToList: () => void;
    } & ({ view: 'create' } | { view: 'detail' | 'edit'; codeId: string }));

function availability(row: GiftCodeDto, at: number) {
  if (row.status === 'inactive') return 'inactive';
  if (row.validUntil && Date.parse(row.validUntil) <= at) return 'expired';
  if (Date.parse(row.validFrom) > at) return 'scheduled';
  if (row.totalLimit !== null && row.usage.consumed >= row.totalLimit) return 'exhausted';
  return 'active';
}

export default function AdminGiftCodesPage({
  queries,
  workspace,
}: {
  queries?: ListQueryBinding;
  workspace?: GiftWorkspace;
} = {}) {
  const record = workspace && workspace.view !== 'list' ? workspace : null;
  const showDetail = record?.view === 'detail';
  const loadList = !record || record.view === 'create';
  const preference = useTimezone();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => tGift(`admin.gifts.${key}`, locale);
  const money = numbers.money;
  const owner = useRef<'validating' | 'review' | null>(null);
  const sending = useRef(false);
  const [validating, setValidating] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [pending, setPending] = useState(false);
  const form: ReturnType<typeof useZodForm<Draft>> = useZodForm<Draft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<Draft>(
        {
          code: label('invalidCode'),
          discountType: label('invalidField'),
          value: label(
            form.getValues('discountType') === 'percentage' ? 'invalidPercent' : 'invalidAmount'
          ),
          cap: label('invalidAmount'),
          eligibility: label('invalidField'),
          profileIds: label('profilesRequired'),
          totalLimit: label('invalidLimit'),
          perProfileLimit: label('invalidLimit'),
          minimum: label('invalidMinimum'),
          categories: label('invalidField'),
          restoreOnCancel: label('invalidField'),
          restoreAfterPayment: label('invalidField'),
          start: label('invalidDate'),
          end: label('invalidDate'),
        },
        (value) => giftDraftErrors(value, preference.timezone, editor === 'new')
      );
    },
    {
      defaultValues: draftFrom(undefined, preference.timezone),
      validationUnavailableMessage: label('validationUnavailable'),
    }
  );
  const [editing, setEditing] = useState(false),
    [draftBasis, setDraftBasis] = useState<string | null>(null),
    [localEditor, setEditor] = useState<string | null>(null);
  const [action, setAction] = useState<GiftReview | null>(null),
    [saved, setSaved] = useState(false);
  const draft = editing ? form.watch() : null;
  const locked = validating || !!action || uncertain;
  const errorFocus = useRef<keyof Draft | null>(null);
  useEffect(() => {
    if (!locked && errorFocus.current) {
      form.setFocus(errorFocus.current);
      errorFocus.current = null;
    }
  }, [locked]);
  function setDraft(value: Draft | null) {
    form.reset(value ?? draftFrom(undefined, preference.timezone));
    setEditing(value !== null);
  }
  function updateDraft(value: Draft) {
    if (owner.current) return;
    for (const name of Object.keys(value) as (keyof Draft)[]) {
      if (value[name] !== form.getValues(name))
        form.setValue(name, value[name], {
          shouldDirty: true,
          shouldValidate: !!(form.formState.errors[name] || form.formState.touchedFields[name]),
        });
    }
  }
  function group(name: keyof Draft, children: ReactNode) {
    return (
      <FormField
        key={name}
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem id={`gift-${name}`}>
            <FormControl>
              <div
                role="group"
                aria-label={label(name === 'profileIds' ? 'profiles' : name)}
                tabIndex={-1}
                ref={field.ref}
                onBlur={field.onBlur}
              >
                {children}
              </div>
            </FormControl>
            <FormMessage reserveSpace={name !== 'start' && name !== 'end'} />
          </FormItem>
        )}
      />
    );
  }
  function closeAction() {
    setAction(null);
    sending.current = false;
    setPending(false);
    if (!uncertain) owner.current = null;
  }
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [type, setType] = useState(''),
    [eligibility, setEligibility] = useState(''),
    [expiry, setExpiry] = useState(''),
    [localFilter, setFilter] = useState('');
  const filter = queries ? giftFilter(queries.query.filters) : localFilter;
  const appliedFilterCount = [...new URLSearchParams(filter).keys()].filter(
    (key) => key !== 'search'
  ).length;
  const applied = queries?.query.filters;
  const appliedKey = JSON.stringify(applied);
  useEffect(() => {
    if (!applied) return;
    setSearch(applied.search || '');
    setStatus(applied.status || '');
    setType(applied.discountType || '');
    setEligibility(applied.eligibility || '');
    setExpiry(applied.expiry || '');
  }, [appliedKey]);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const clearPrivate = useCallback(() => {
    setDraft(null);
    setDraftBasis(null);
    setEditor(null);
    setAction(null);
    setSaved(false);
    owner.current = null;
    sending.current = false;
    setPending(false);
    setUncertain(false);
  }, []);
  const scope = useCatalogueScope(clearPrivate);
  const catalogue = useGiftCodeCatalogue(
    scope,
    filter,
    loadList && preference.status === 'ready',
    queries
  );
  const editor = scope.denied
    ? null
    : record
      ? record.view === 'create'
        ? 'new'
        : record.codeId
      : localEditor;
  const [editorScope, setEditorScope] = useState(editor);
  if (editorScope !== editor) {
    setEditorScope(editor);
    setEditing(false);
    setDraftBasis(null);
    setAction(null);
    owner.current = null;
    setUncertain(false);
  }
  const queryScope = JSON.stringify([filter, queries?.query.cursor ?? '', editor]);
  const validateStats = useCallback(
    (value: unknown): value is GiftCodeStats => isGiftCodeStats(value) && value.code.id === editor,
    [editor]
  );
  const detail = useCatalogueResource(
    scope,
    preference.status === 'ready' && editor && editor !== 'new'
      ? `/api/admin/promotions/gift-codes/${editor}/stats`
      : null,
    validateStats,
    { clearOnMissing: true }
  );
  const rows = catalogue.rows ?? [],
    stats = detail.data;
  const zone = preference.timezone;
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }),
    [locale, zone]
  );
  const formatDate = (value: string) => {
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))
      throw new RangeError('A timestamp with an explicit UTC offset is required');
    return dateFormatter.format(new Date(value));
  };
  const profileName = (id: string) =>
    stats?.perProfile.find((row) => row.profileId === id)?.profileTitle ?? id;
  const selected = rows.find((row) => row.id === editor);
  const editorBasis =
    editor === 'new'
      ? `new:${zone}`
      : stats
        ? `${zone}:${giftCodeBasis(stats.code)}:${selected ? giftCodeBasis(selected) : ''}`
        : null;
  const stale = !!draft && draftBasis !== editorBasis;
  const ready =
    !scope.denied &&
    preference.status === 'ready' &&
    (loadList
      ? catalogue.rows !== null && !catalogue.loading && !catalogue.pending
      : !!stats && !detail.loading && !detail.error);
  const editorReady =
    ready &&
    (editor === 'new' ||
      (!!stats &&
        !detail.loading &&
        !detail.error &&
        (!selected || Date.parse(selected.updatedAt) <= Date.parse(stats.code.updatedAt))));
  const currentBasis =
    action?.id && action.path.endsWith('/toggle')
      ? stats?.code.id === action.id && showDetail
        ? stats.code
        : rows.find((r) => r.id === action.id)
      : null;
  const reviewBasis = currentBasis ? giftCodeBasis(currentBasis) : editor ? editorBasis : null;
  const liveReview = useRef({ action, basis: reviewBasis, queryScope });
  liveReview.current = { action, basis: reviewBasis, queryScope };
  useEffect(() => {
    if (editor && !showDetail && !draft && editorReady) {
      setDraft(draftFrom(stats?.code, zone));
      setDraftBasis(editorBasis);
    }
  }, [editor, showDetail, draft, editorReady, stats, zone, editorBasis]);
  useEffect(() => {
    if (
      action &&
      (action.epoch !== scope.version ||
        action.basis !== reviewBasis ||
        action.queryScope !== queryScope)
    ) {
      setAction(null);
      sending.current = false;
      setPending(false);
      if (!uncertain) owner.current = null;
    }
  }, [action, reviewBasis, scope.version, queryScope]);
  const refresh = () => {
    if (sending.current) return;
    if (preference.status === 'error') preference.retry();
    if (scope.denied) scope.recover();
    else {
      if (loadList) catalogue.retry();
      detail.retry();
    }
  };
  const recovery = (dialog = false) => (
    <div className="flex flex-wrap gap-2">
      <Button
        ref={dialog ? undefined : refreshButton}
        type="button"
        variant="outline"
        disabled={
          pending ||
          (dialog && (catalogue.loading || detail.loading || preference.status === 'loading'))
        }
        onClick={refresh}
      >
        {label(record && record.view !== 'create' ? 'refreshStats' : 'refresh')}
      </Button>
      {dialog && (catalogue.error || detail.error) && <p role="alert">{label('error')}</p>}
    </div>
  );
  function choose(value: string | null) {
    if (owner.current) return;
    if (preference.status === 'error') preference.retry();
    setDraft(null);
    setDraftBasis(null);
    setUncertain(false);
    setSaved(false);
    setAction(null);
    if (record?.view === 'edit') record.goToRecord(record.codeId);
    else if (record?.view === 'create') record.goToList();
    else setEditor(value);
  }
  function propose(
    path: string,
    method: TeamAction['method'],
    title: string,
    description: string,
    body: unknown,
    row?: GiftCodeDto
  ) {
    if (!ready || action || owner.current || (editor && (!editorReady || stale))) return;
    owner.current = 'review';
    setSaved(false);
    setAction({
      epoch: scope.version,
      queryScope,
      id: row?.id ?? (editor === 'new' ? null : editor),
      basis: row ? giftCodeBasis(row) : editorBasis!,
      path,
      method,
      ...(body && typeof body === 'object' && 'status' in body && body.status === 'inactive'
        ? { risk: 'destructive' as const }
        : {}),
      title,
      description,
      body,
      forbiddenMessage: label('denied'),
      conflictMessage: label('conflict'),
      errorMessages: {
        'VALIDATION:PARSE:ZOD_ERROR': label('invalid'),
        GIFT_CODE_INVALID_PAYLOAD: label('invalid'),
        GIFT_CODE_INVALID_WINDOW: label('invalidDate'),
        GIFT_CODE_PROFILES_REQUIRED: label('profilesRequired'),
        GIFT_CODE_ALREADY_EXISTS: label('duplicate'),
      },
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !editor || !editorReady || stale || owner.current) return;
    owner.current = 'validating';
    setValidating(true);
    const epoch = scope.version,
      basis = editorBasis,
      query = queryScope;
    try {
      await form.handleSubmit((value) => {
        if (
          scope.live.current !== epoch ||
          liveReview.current.basis !== basis ||
          liveReview.current.queryScope !== query
        )
          return;
        const body = giftDraftPayload(value, zone);
        owner.current = null;
        propose(
          `/api/admin/promotions/gift-codes${editor === 'new' ? '' : `/${editor}`}`,
          editor === 'new' ? 'POST' : 'PATCH',
          label('save'),
          label('confirmSave'),
          body
        );
      })(event);
    } finally {
      setValidating(false);
      if (owner.current === 'validating') owner.current = null;
    }
  }
  const proposed =
    action && !action.path.endsWith('/toggle')
      ? (action.body as ReturnType<typeof giftDraftPayload>)
      : null;
  const now = Date.now();
  const restoration = (row: GiftCodeDto) =>
    label(
      !row.restoreOnCancel
        ? 'noRestoration'
        : row.restoreAfterPayment
          ? 'restorePaid'
          : 'restoreUnpaid'
    );
  const discount = (row: GiftCodeDto) =>
    row.discountType === 'percentage'
      ? numbers.percent(Number(row.discountValue) / 10000)
      : money(row.discountValue);
  const categories = (values: string[]) =>
    values.length
      ? values.map((category) => label(`category.${category}`)).join(locale === 'fa' ? '، ' : ', ')
      : label('all');
  const toggleCode = (row: GiftCodeDto) =>
    propose(
      `/api/admin/promotions/gift-codes/${row.id}/toggle`,
      'POST',
      label(row.status === 'active' ? 'deactivate' : 'activate'),
      `${row.code}. ${label('confirmStatus')}`,
      { status: row.status === 'active' ? 'inactive' : 'active' },
      row
    );
  const canRender = !scope.denied && (loadList ? catalogue.rows !== null : !!editor);
  const capSubtotal = draft?.discountType === 'percentage' ? giftCapSubtotal(draft) : null;
  const isEditorRoute = !!record && record.view !== 'detail';
  return (
    <div
      className={`mx-auto flex w-full min-w-0 flex-col ${isEditorRoute ? 'max-w-3xl gap-4 p-4 md:px-8' : record ? 'max-w-5xl gap-6 p-4 md:p-8' : 'max-w-7xl gap-6'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {record && (
            <Link
              to="/admin/gift-codes"
              search={record.search}
              className="w-fit text-sm font-medium text-primary hover:underline"
            >
              {label('title')}
            </Link>
          )}
          <h1 className="break-words text-2xl font-semibold">
            {!record ? (
              label('title')
            ) : record.view === 'create' ? (
              label('add')
            ) : showDetail ? (
              stats ? (
                <bdi>{stats.code.code}</bdi>
              ) : (
                label('code')
              )
            ) : (
              <>
                {label('edit')}
                {stats && (
                  <>
                    {' '}
                    <bdi>{stats.code.code}</bdi>
                  </>
                )}
              </>
            )}
          </h1>
          {showDetail && stats && (
            <Badge variant={availability(stats.code, now) === 'active' ? 'success' : 'outline'}>
              {label(availability(stats.code, now))}
            </Badge>
          )}
        </div>
        {isEditorRoute && (
          <ListRefreshButton
            ref={refreshButton}
            label={label(record.view === 'create' ? 'refresh' : 'refreshStats')}
            disabled={pending}
            onClick={refresh}
          />
        )}
        {workspace?.view === 'list' && (
          <Link
            to="/admin/gift-codes/$codeId/{-$action}"
            params={{ codeId: 'new', action: undefined }}
            search={workspace.search}
            disabled={!ready || locked}
            className={buttonVariants({ className: 'min-h-11' })}
          >
            {label('add')}
          </Link>
        )}
        {showDetail && stats && (
          <div className="flex flex-wrap gap-2">
            <Link
              to="/admin/gift-codes/$codeId/{-$action}"
              params={{ codeId: stats.code.id, action: 'edit' }}
              search={record.search}
              disabled={!ready || locked}
              className={buttonVariants({ className: 'min-h-11' })}
            >
              {label('edit')}
            </Link>
            <Button
              type="button"
              variant="outline"
              disabled={!ready || locked}
              onClick={() => toggleCode(stats.code)}
            >
              {label(stats.code.status === 'active' ? 'deactivate' : 'activate')}
            </Button>
          </div>
        )}
      </header>
      <ListPage>
        {record ? (
          !isEditorRoute && <ListPage.Toolbar>{recovery()}</ListPage.Toolbar>
        ) : (
          <form
            aria-label={label('filters')}
            onSubmit={(event) => {
              event.preventDefault();
              if (owner.current) return;
              const filters = {
                search: search.trim(),
                status,
                discountType: type,
                eligibility,
                expiry,
              };
              if (queries) {
                queries.setQuery({ filters, cursor: '' });
                if (giftFilter(filters) === filter && !queries.query.cursor) catalogue.retry();
              } else {
                choose(null);
                setFilter(giftFilter(filters));
                catalogue.retry();
              }
              if (preference.status === 'error') preference.retry();
              if (scope.denied) scope.recover();
            }}
          >
            <ListPage.Toolbar
              search={
                <ListSearchInput
                  label={label('searchCode')}
                  disabled={locked}
                  id="gift-search"
                  maxLength={64}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              }
              moreFilters={{
                label: label('filters'),
                count: appliedFilterCount ? numbers.number(appliedFilterCount) : undefined,
                children: (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="flex min-w-0 flex-col gap-2">
                      <Label htmlFor="gift-status-filter">{label('status')}</Label>
                      <NativeSelect
                        disabled={locked}
                        id="gift-status-filter"
                        className="w-full"
                        value={status}
                        onChange={(event) => setStatus(event.target.value)}
                      >
                        <option value="">{label('all')}</option>
                        <option value="active">{label('active')}</option>
                        <option value="inactive">{label('inactive')}</option>
                      </NativeSelect>
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                      <Label htmlFor="gift-type-filter">{label('type')}</Label>
                      <NativeSelect
                        disabled={locked}
                        id="gift-type-filter"
                        className="w-full"
                        value={type}
                        onChange={(event) => setType(event.target.value)}
                      >
                        <option value="">{label('all')}</option>
                        <option value="fixed_irr">{label('fixed')}</option>
                        <option value="percentage">{label('percentage')}</option>
                      </NativeSelect>
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                      <Label htmlFor="gift-eligibility-filter">{label('eligibility')}</Label>
                      <NativeSelect
                        disabled={locked}
                        id="gift-eligibility-filter"
                        className="w-full"
                        value={eligibility}
                        onChange={(event) => setEligibility(event.target.value)}
                      >
                        <option value="">{label('all')}</option>
                        <option value="public">{label('public')}</option>
                        <option value="profile">{label('restricted')}</option>
                      </NativeSelect>
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                      <Label htmlFor="gift-expiry-filter">{label('expiry')}</Label>
                      <NativeSelect
                        disabled={locked}
                        id="gift-expiry-filter"
                        className="w-full"
                        value={expiry}
                        onChange={(event) => setExpiry(event.target.value)}
                      >
                        <option value="">{label('all')}</option>
                        <option value="not_expired">{label('notExpired')}</option>
                        <option value="expired">{label('expired')}</option>
                      </NativeSelect>
                    </div>
                  </div>
                ),
              }}
              actions={
                <Button type="submit" variant="secondary" disabled={locked}>
                  {label('search')}
                </Button>
              }
              refresh={
                <ListRefreshButton
                  ref={refreshButton}
                  label={label('refresh')}
                  disabled={pending}
                  refreshing={catalogue.loading}
                  focusableWhenDisabled={catalogue.loading && !pending}
                  onClick={refresh}
                />
              }
            />
          </form>
        )}
        <CommandFeedback message={saved ? label('saved') : null} />
        {uncertain && (
          <div role="alert" className="space-y-2">
            <p>{label('uncertain')}</p>
            <Button
              type="button"
              variant="outline"
              disabled={!ready || (!!editor && !editorReady)}
              onClick={() => {
                if (!ready || (editor && !editorReady)) return;
                owner.current = null;
                setUncertain(false);
              }}
            >
              {label('resumeEditing')}
            </Button>
          </div>
        )}
        <ListPage.Content
          loading={catalogue.loading || preference.status === 'loading'}
          error={catalogue.error || scope.denied || preference.status === 'error'}
          empty={false}
          emptyView={null}
          retainContent={canRender}
          loadingView={
            record ? (
              <RecordDetailSkeleton label={label('loading')} layout="payment" />
            ) : (
              <RecordListSkeleton label={label('loading')} view="card" headings={[]} />
            )
          }
          errorView={<p role="alert">{scope.denied ? label('denied') : label('error')}</p>}
        >
          {canRender && (
            <>
              {!workspace && (
                <div>
                  <Button disabled={!ready || locked} onClick={() => choose('new')}>
                    {label('add')}
                  </Button>
                </div>
              )}
              {editor && editor !== 'new' && (
                <div className="space-y-2">
                  {!record && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={detail.loading || pending}
                      onClick={() => {
                        if (!sending.current) detail.retry();
                      }}
                    >
                      {label('refreshStats')}
                    </Button>
                  )}
                  {!record && !draft && (
                    <Button type="button" variant="outline" onClick={() => choose(null)}>
                      {label('cancel')}
                    </Button>
                  )}
                  {detail.loading && <LoadingStatus>{label('loading')}</LoadingStatus>}
                  {detail.error && (
                    <p role="alert">
                      {label(detail.missing ? 'missing' : 'statsError')}{' '}
                      {!detail.missing && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            if (!sending.current) detail.retry();
                          }}
                        >
                          {label('retry')}
                        </Button>
                      )}
                    </p>
                  )}
                </div>
              )}
              {draft && (
                <Form {...form}>
                  <form
                    aria-label={label('editor')}
                    noValidate
                    onChangeCapture={(event) => {
                      if (owner.current) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }}
                    onSubmit={save}
                    className="min-w-0 rounded-xl border bg-card [&_[data-slot=form-message]]:min-h-4"
                  >
                    {stale && (
                      <p className="mx-4 mt-4 text-destructive" role="alert">
                        {label('stale')}
                      </p>
                    )}
                    <fieldset disabled={locked} className="min-w-0">
                      <legend className="sr-only">{label('editor')}</legend>
                      <RecordEditorSection title={label('discount')}>
                        <div className={`${recordEditorGrid} min-[375px]:grid-cols-2`}>
                          <FormInput
                            control={form.control}
                            name="code"
                            id="gift-code"
                            label={label('code')}
                            disabled={locked}
                            inputProps={{
                              dir: 'ltr',
                              maxLength: 64,
                              'aria-required': true,
                              placeholder: 'AUTUMN-25',
                            }}
                          />
                          <FormField
                            control={form.control}
                            name="discountType"
                            render={({ field }) => (
                              <FormItem id="gift-type">
                                <FormLabel>{label('type')}</FormLabel>
                                <FormControl>
                                  <NativeSelect
                                    id="gift-type"
                                    aria-required="true"
                                    name={field.name}
                                    ref={field.ref}
                                    onBlur={field.onBlur}
                                    disabled={locked}
                                    className="w-full"
                                    value={draft.discountType}
                                    onChange={(event) =>
                                      updateDraft({
                                        ...draft,
                                        discountType: event.target.value as Draft['discountType'],
                                        value: '',
                                        cap: '',
                                      })
                                    }
                                  >
                                    <option value="fixed_irr">{label('fixed')}</option>
                                    <option value="percentage">{label('percentage')}</option>
                                  </NativeSelect>
                                </FormControl>
                                <FormMessage reserveSpace />
                              </FormItem>
                            )}
                          />
                          <FormInput
                            control={form.control}
                            name="value"
                            id="gift-value"
                            label={label(
                              draft.discountType === 'percentage' ? 'percent' : 'amount'
                            )}
                            disabled={locked}
                            inputProps={{
                              inputMode:
                                draft.discountType === 'percentage' ? 'decimal' : 'numeric',
                              maxLength: 19,
                              dir: 'ltr',
                              'aria-required': true,
                            }}
                          />
                          {draft.discountType === 'percentage' && (
                            <>
                              <FormInput
                                control={form.control}
                                name="cap"
                                id="gift-cap"
                                label={label('cap')}
                                disabled={locked}
                                inputProps={{
                                  inputMode: 'numeric',
                                  maxLength: 19,
                                  dir: 'ltr',
                                  'aria-required': true,
                                }}
                              />
                            </>
                          )}
                        </div>
                        {draft.discountType === 'percentage' && (
                          <div
                            role="note"
                            className="space-y-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
                          >
                            <p>{label('percentageWarning')}</p>
                            {capSubtotal !== null && (
                              <dl className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t pt-2">
                                <dt>{label('capSubtotal')}</dt>
                                <dd className="font-medium text-foreground tabular-nums wrap-anywhere">
                                  <bdi>{money(capSubtotal)}</bdi>
                                </dd>
                              </dl>
                            )}
                          </div>
                        )}
                      </RecordEditorSection>
                      <RecordEditorSection title={label('applicability')}>
                        <FormField
                          control={form.control}
                          name="eligibility"
                          render={({ field }) => (
                            <FormItem id="gift-eligibility">
                              <FormLabel>{label('eligibility')}</FormLabel>
                              <FormControl>
                                <NativeSelect
                                  id="gift-eligibility"
                                  aria-required="true"
                                  name={field.name}
                                  ref={field.ref}
                                  onBlur={field.onBlur}
                                  disabled={locked}
                                  className="w-full"
                                  value={draft.eligibility}
                                  onChange={(event) =>
                                    updateDraft({
                                      ...draft,
                                      eligibility: event.target.value as Draft['eligibility'],
                                      profileIds: [],
                                    })
                                  }
                                >
                                  <option value="public">{label('public')}</option>
                                  <option value="profile">{label('restricted')}</option>
                                </NativeSelect>
                              </FormControl>
                              <FormMessage reserveSpace />
                            </FormItem>
                          )}
                        />
                        {draft.eligibility === 'profile' &&
                          group(
                            'profileIds',
                            <GiftProfilePicker
                              ids={draft.profileIds}
                              onChange={(profileIds) => updateDraft({ ...draft, profileIds })}
                              onDenied={scope.deny}
                              label={label}
                            />
                          )}
                        {group(
                          'categories',
                          <fieldset className="rounded-lg border px-3 pb-3">
                            <legend className="px-1 font-semibold">{label('categories')}</legend>
                            <p className="mb-1 text-xs text-muted-foreground">
                              {label('categoriesHelp')}
                            </p>
                            <div className="grid gap-x-2 min-[375px]:grid-cols-2 sm:grid-cols-3">
                              {GIFT_CODE_CATEGORIES.map((category) => (
                                <label
                                  key={category}
                                  className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/40"
                                >
                                  <input
                                    type="checkbox"
                                    className="size-4 shrink-0 accent-primary"
                                    checked={draft.categories.includes(category)}
                                    onChange={(event) =>
                                      updateDraft({
                                        ...draft,
                                        categories: event.target.checked
                                          ? [...draft.categories, category]
                                          : draft.categories.filter((value) => value !== category),
                                      })
                                    }
                                  />
                                  {label(`category.${category}`)}
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        )}
                      </RecordEditorSection>
                      <RecordEditorSection title={label('usageLimits')}>
                        <div className={recordEditorGrid}>
                          {(['totalLimit', 'perProfileLimit'] as const).map((field) => (
                            <FormInput
                              key={field}
                              control={form.control}
                              name={field}
                              id={`gift-${field}`}
                              label={label(field)}
                              disabled={locked}
                              inputProps={{
                                inputMode: 'numeric',
                                maxLength: 10,
                                placeholder: label('unlimited'),
                                dir: 'ltr',
                              }}
                            />
                          ))}
                          <FormInput
                            control={form.control}
                            name="minimum"
                            id="gift-minimum"
                            label={label('minimum')}
                            disabled={locked}
                            inputProps={{
                              inputMode: 'numeric',
                              maxLength: 19,
                              dir: 'ltr',
                              'aria-required': true,
                            }}
                          />
                        </div>
                      </RecordEditorSection>
                      <RecordEditorSection title={label('window')}>
                        <p
                          id="gift-validity-timezone"
                          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground"
                        >
                          {label('timezone')} <bdi className="font-medium">{zone}</bdi>
                        </p>
                        {(['start', 'end'] as const).map((field) =>
                          group(
                            field,
                            <fieldset
                              key={field}
                              className="min-w-0 space-y-3 rounded-lg border px-3 pb-3"
                            >
                              <legend className="px-1 text-sm font-medium">{label(field)}</legend>
                              {(field === 'end' || editor === 'new') && (
                                <div className="grid w-fit max-w-full grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1">
                                  {(field === 'start'
                                    ? ['startImmediately', 'setStart']
                                    : ['noExpiry', 'setEnd']
                                  ).map((choice, index) => (
                                    <label key={choice} className="relative min-w-0">
                                      <input
                                        type="radio"
                                        name={`gift-${field}-mode`}
                                        className="peer absolute inset-0 size-full cursor-pointer opacity-0"
                                        checked={draft[field].enabled === (index === 1)}
                                        onChange={() =>
                                          updateDraft({
                                            ...draft,
                                            [field]: { ...draft[field], enabled: index === 1 },
                                          })
                                        }
                                      />
                                      <span className="flex min-h-11 items-center justify-center rounded-md border border-transparent px-2 py-1 text-center text-sm text-muted-foreground peer-hover:bg-muted peer-checked:border-border peer-checked:bg-card peer-checked:font-medium peer-checked:text-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-ring sm:px-3">
                                        {label(choice)}
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              )}
                              {draft[field].enabled && (
                                <div className={`${recordEditorGrid} items-start gap-y-3`}>
                                  <div className={recordEditorField}>
                                    <Label htmlFor={`gift-${field}-date`}>
                                      {label(`${field}Date`)}
                                    </Label>
                                    <DatePicker
                                      id={`gift-${field}-date`}
                                      label={label(`${field}Date`)}
                                      placeholder={label('chooseDate')}
                                      className="min-h-11"
                                      locale={locale}
                                      timezone={zone}
                                      value={draft[field].date}
                                      triggerProps={{
                                        'aria-required': true,
                                        'aria-invalid': !!form.formState.errors[field] || undefined,
                                        'aria-describedby': form.formState.errors[field]
                                          ? `gift-${field}-message`
                                          : 'gift-validity-timezone',
                                      }}
                                      onChange={(date) =>
                                        updateDraft({
                                          ...draft,
                                          [field]: { ...draft[field], date, changed: true },
                                        })
                                      }
                                    />
                                  </div>
                                  <div className={recordEditorField}>
                                    <Label htmlFor={`gift-${field}-time`}>
                                      {label(`${field}Time`)}
                                    </Label>
                                    <div className="group relative">
                                      <RecordTimeInput
                                        id={`gift-${field}-time`}
                                        locale={locale}
                                        required
                                        aria-required="true"
                                        aria-invalid={!!form.formState.errors[field] || undefined}
                                        aria-describedby={
                                          form.formState.errors[field]
                                            ? `gift-${field}-message`
                                            : 'gift-validity-timezone'
                                        }
                                        className={
                                          locale === 'en' && !draft[field].time
                                            ? 'text-transparent focus:text-foreground [&::-webkit-date-and-time-value]:opacity-0 focus:[&::-webkit-date-and-time-value]:opacity-100'
                                            : undefined
                                        }
                                        value={draft[field].time}
                                        onChange={(time) =>
                                          updateDraft({
                                            ...draft,
                                            [field]: {
                                              ...draft[field],
                                              time,
                                              changed: true,
                                            },
                                          })
                                        }
                                      />
                                      {locale === 'en' && !draft[field].time && (
                                        <span
                                          aria-hidden="true"
                                          className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm text-muted-foreground group-focus-within:hidden"
                                        >
                                          {label('chooseTime')}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </fieldset>
                          )
                        )}
                      </RecordEditorSection>
                      <RecordEditorSection title={label('restorationPolicy')}>
                        {group(
                          'restoreAfterPayment',
                          <fieldset className="space-y-2">
                            <legend className="sr-only">{label('restorationPolicy')}</legend>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={draft.restoreOnCancel}
                                onChange={(event) =>
                                  updateDraft({
                                    ...draft,
                                    restoreOnCancel: event.target.checked,
                                    restoreAfterPayment:
                                      event.target.checked && draft.restoreAfterPayment,
                                  })
                                }
                              />
                              {label('restoreOnCancel')}
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={draft.restoreAfterPayment}
                                disabled={!draft.restoreOnCancel}
                                onChange={(event) =>
                                  updateDraft({
                                    ...draft,
                                    restoreAfterPayment: event.target.checked,
                                  })
                                }
                              />
                              {label('restoreAfterPayment')}
                            </label>
                          </fieldset>
                        )}
                      </RecordEditorSection>
                      {form.formState.errors.root?.validation?.message && (
                        <p role="alert">{form.formState.errors.root.validation.message}</p>
                      )}
                      <RecordEditorActions className="rounded-b-xl bg-card px-3 py-2 max-lg:sticky max-lg:bottom-0 max-lg:z-20 sm:px-4">
                        {stale && (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={locked || !editorReady}
                            onClick={() => {
                              setDraft(draftFrom(stats?.code, zone));
                              setDraftBasis(editorBasis);
                            }}
                          >
                            {label('reset')}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          disabled={locked}
                          onClick={() => choose(null)}
                        >
                          {label('cancel')}
                        </Button>
                        <FormSubmit loading={validating} disabled={locked || !editorReady || stale}>
                          {label('save')}
                        </FormSubmit>
                      </RecordEditorActions>
                    </fieldset>
                  </form>
                </Form>
              )}
              {showDetail && stats && (
                <section
                  className="space-y-4 rounded-xl border bg-card p-4 md:p-6"
                  aria-label={label('editor')}
                >
                  <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    {(
                      [
                        ['discount', discount(stats.code)],
                        ...(stats.code.maxCapIrr ? [['cap', money(stats.code.maxCapIrr)]] : []),
                        [
                          'eligibility',
                          label(stats.code.eligibility === 'profile' ? 'restricted' : 'public'),
                        ],
                        ['categories', categories(stats.code.categories)],
                        ['minimum', money(stats.code.minOrderAmount)],
                        ['start', formatDate(stats.code.validFrom)],
                        [
                          'end',
                          stats.code.validUntil
                            ? formatDate(stats.code.validUntil)
                            : label('noExpiry'),
                        ],
                        [
                          'totalLimit',
                          stats.code.totalLimit === null
                            ? label('unlimited')
                            : numbers.number(stats.code.totalLimit),
                        ],
                        [
                          'perProfileLimit',
                          stats.code.perProfileLimit === null
                            ? label('unlimited')
                            : numbers.number(stats.code.perProfileLimit),
                        ],
                        ['restorationPolicy', restoration(stats.code)],
                      ] as const
                    ).map(([key, value]) => (
                      <div
                        key={key}
                        className={
                          key === 'discount'
                            ? 'min-w-0 rounded-lg bg-muted/40 p-3 sm:col-span-2'
                            : 'min-w-0'
                        }
                      >
                        <dt className="text-sm text-muted-foreground">{label(key!)}</dt>
                        <dd
                          className={
                            key === 'discount'
                              ? 'mt-1 text-xl font-semibold tabular-nums'
                              : 'mt-1 font-medium'
                          }
                          dir="auto"
                        >
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {stats.code.eligibility === 'profile' && (
                    <GiftProfilePicker
                      ids={stats.code.profileIds}
                      label={label}
                      onDenied={scope.deny}
                    />
                  )}
                </section>
              )}
              {stats && (showDetail || !workspace) && (
                <section
                  aria-label={label('usageStats')}
                  className="space-y-4 rounded-xl border bg-card p-4 md:p-6"
                >
                  <h2 className="text-lg font-semibold">{label('usageStats')}</h2>
                  <dl className="grid gap-4 border-b pb-4 sm:grid-cols-3">
                    <div>
                      <dt className="text-sm text-muted-foreground">{label('consumed')}</dt>
                      <dd className="font-medium tabular-nums">
                        {numbers.number(stats.code.usage.consumed)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">{label('released')}</dt>
                      <dd className="font-medium tabular-nums">
                        {numbers.number(stats.code.usage.released)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">{label('totalDiscount')}</dt>
                      <dd className="font-medium tabular-nums">
                        {money(stats.code.usage.totalDiscountIrr)}
                      </dd>
                    </div>
                  </dl>
                  <div>
                    <h3 className="font-medium">{label('profileUsage')}</h3>
                    {stats.perProfile.length ? (
                      <ul className="divide-y">
                        {stats.perProfile.map((item) => (
                          <li key={item.profileId} className="py-2">
                            <bdi className="[overflow-wrap:anywhere]" title={item.profileId}>
                              {item.profileTitle}
                            </bdi>
                            <span className="block text-sm text-muted-foreground">
                              {label('consumed')}: {numbers.number(item.consumed)} ·{' '}
                              {label('released')}: {numbers.number(item.released)} ·{' '}
                              {label('totalDiscount')}: {money(item.discountIrr)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>{label('noUsage')}</p>
                    )}
                  </div>
                  <div>
                    <h3 className="font-medium">{label('recentRedemptions')}</h3>
                    {stats.recentRedemptions.length ? (
                      <ul className="divide-y">
                        {stats.recentRedemptions.map((item) => (
                          <li key={item.id} className="py-2 text-sm">
                            <bdi className="[overflow-wrap:anywhere]">
                              {profileName(item.profileId)}
                            </bdi>{' '}
                            · <span>{label('order')}: </span>
                            <bdi className="[overflow-wrap:anywhere]">{item.orderId}</bdi> ·{' '}
                            {money(item.discountAmount)}
                            <span className="block text-muted-foreground">
                              {label(item.status)} · {formatDate(item.createdAt)}
                              {item.restoredAt &&
                                ` · ${label('restoredAt')}: ${formatDate(item.restoredAt)}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>{label('noUsage')}</p>
                    )}
                  </div>
                </section>
              )}
              {!record && (
                <>
                  <OperationalQueueTable
                    locale={locale}
                    cardHeading="h2"
                    rows={rows}
                    caption={label('title')}
                    scrollLabel={label('tableTitle')}
                    nameHeader={label('code')}
                    loading={catalogue.loading || catalogue.pending}
                    emptyMessage={label('empty')}
                    tableClassName="min-w-[52rem] [&_[data-slot=table-cell-details]]:min-w-28 [&_td]:px-2.5 [&_th]:px-2.5 [&_th[scope=row]]:min-w-36"
                    fieldGroups={[
                      {
                        label: label('eligibility'),
                        fields: ['eligibility', 'restoration'],
                      },
                      {
                        label: label('usageStats'),
                        fields: ['consumed', 'released', 'totalDiscount'],
                      },
                    ]}
                    renderName={(row) =>
                      workspace ? (
                        <Link
                          to="/admin/gift-codes/$codeId/{-$action}"
                          params={{ codeId: row.id, action: undefined }}
                          search={workspace.search}
                          disabled={!ready || locked}
                          className="inline-flex max-w-48 rounded-md bg-primary/8 px-1.5 py-1 font-mono text-[0.8125rem] leading-5 font-semibold text-primary hover:bg-primary/12 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <bdi dir="ltr" className="wrap-anywhere">
                            {row.code}
                          </bdi>
                        </Link>
                      ) : (
                        <TextCell value={row.code} />
                      )
                    }
                    fields={[
                      {
                        id: 'status',
                        label: label('status'),
                        render: (row) => (
                          <Badge
                            variant={availability(row, now) === 'active' ? 'success' : 'outline'}
                          >
                            {label(availability(row, now))}
                          </Badge>
                        ),
                      },
                      {
                        id: 'eligibility',
                        label: label('eligibility'),
                        render: (row) => (
                          <>{label(row.eligibility === 'profile' ? 'restricted' : 'public')}</>
                        ),
                      },
                      {
                        id: 'restoration',
                        label: label('restorationPolicy'),
                        render: (row) => <>{restoration(row)}</>,
                      },
                      {
                        id: 'discount',
                        label: label('discount'),
                        render: (row) => (
                          <div className="space-y-1">
                            <span className="block text-xs text-muted-foreground">
                              {label(row.discountType === 'percentage' ? 'percentage' : 'fixed')}
                            </span>
                            <bdi className="tabular-nums">{discount(row)}</bdi>
                            {row.discountType === 'percentage' && (
                              <span className="block">
                                {label('cap')}:{' '}
                                <bdi className="tabular-nums">{money(row.maxCapIrr!)}</bdi>
                              </span>
                            )}
                          </div>
                        ),
                      },
                      {
                        id: 'window',
                        label: label('window'),
                        render: (row) => (
                          <div className="space-y-2 text-sm md:whitespace-nowrap">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-muted-foreground">
                                {label('start')}
                              </span>
                              <DateCell
                                value={row.validFrom}
                                format={() => formatDate(row.validFrom)}
                              />
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-muted-foreground">{label('end')}</span>
                              {row.validUntil ? (
                                <DateCell
                                  value={row.validUntil}
                                  format={() => formatDate(row.validUntil!)}
                                />
                              ) : (
                                label('noExpiry')
                              )}
                            </div>
                          </div>
                        ),
                      },
                      {
                        id: 'consumed',
                        label: label('consumed'),
                        render: (row) => (
                          <bdi className="tabular-nums">{numbers.number(row.usage.consumed)}</bdi>
                        ),
                      },
                      {
                        id: 'released',
                        label: label('released'),
                        render: (row) => (
                          <bdi className="tabular-nums">{numbers.number(row.usage.released)}</bdi>
                        ),
                      },
                      {
                        id: 'totalDiscount',
                        label: label('totalDiscount'),
                        render: (row) => (
                          <bdi className="tabular-nums md:whitespace-nowrap">
                            {money(row.usage.totalDiscountIrr)}
                          </bdi>
                        ),
                      },
                    ]}
                    actionHeader={label('actions')}
                    renderActions={(row) => (
                      <div className="flex flex-wrap gap-2">
                        {workspace ? (
                          <Link
                            to="/admin/gift-codes/$codeId/{-$action}"
                            params={{ codeId: row.id, action: 'edit' }}
                            search={workspace.search}
                            disabled={!ready || locked}
                            className={buttonVariants({
                              variant: 'outline',
                              className: 'min-h-11',
                            })}
                            aria-label={`${label('edit')} ${row.code}`}
                            data-table-action-tooltip={label('edit')}
                          >
                            <TableActionIcon icon={TablePencilIcon}>
                              {label('edit')}
                            </TableActionIcon>
                          </Link>
                        ) : (
                          <Button
                            variant="outline"
                            disabled={!ready || locked}
                            aria-label={`${label('edit')} ${row.code}`}
                            onClick={() => choose(row.id)}
                            data-table-action-tooltip={label('edit')}
                          >
                            <TableActionIcon icon={TablePencilIcon}>
                              {label('edit')}
                            </TableActionIcon>
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          disabled={!ready || locked}
                          aria-label={`${label(row.status === 'active' ? 'deactivate' : 'activate')} ${row.code}`}
                          onClick={() => toggleCode(row)}
                          data-table-action-tooltip={label(
                            row.status === 'active' ? 'deactivate' : 'activate'
                          )}
                        >
                          <TableActionIcon
                            icon={row.status === 'active' ? TableBanIcon : TableCheckCircleIcon}
                          >
                            {label(row.status === 'active' ? 'deactivate' : 'activate')}
                          </TableActionIcon>
                        </Button>
                      </div>
                    )}
                  />
                  {catalogue.more === 'error' && <p role="alert">{label('moreError')}</p>}
                  <ListPage.Pagination
                    kind="cursor"
                    hasMore={catalogue.hasMore}
                    loading={catalogue.more === 'loading' || locked}
                    onNext={() => {
                      if (!owner.current) void catalogue.loadMore();
                    }}
                    label={label('pagination')}
                    nextLabel={label('loadMore')}
                  />
                </>
              )}
            </>
          )}
        </ListPage.Content>
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          onClose={closeAction}
          onDenied={scope.deny}
          onPendingChange={(value) => {
            sending.current = value;
            setPending(value);
          }}
          onUnconfirmed={() => {
            if (scope.live.current !== action.epoch || liveReview.current.action !== action) return;
            setUncertain(true);
            setAction(null);
            sending.current = false;
            setPending(false);
            if (loadList) catalogue.retry();
            detail.retry();
          }}
          onValidationError={(fields) => {
            if (
              scope.live.current !== action.epoch ||
              liveReview.current.action !== action ||
              action.path.endsWith('/toggle')
            )
              return false;
            const names = fields
              .filter(
                (field): field is string =>
                  typeof field === 'string' && Object.hasOwn(giftFieldNames, field)
              )
              .map((field) => giftFieldNames[field]!);
            if (!names.length) return false;
            for (const name of names)
              form.setError(name, {
                type: 'server',
                message: label(
                  name === 'start' || name === 'end'
                    ? 'invalidDate'
                    : name === 'profileIds'
                      ? 'profilesRequired'
                      : 'invalidField'
                ),
              });
            errorFocus.current = names[0]!;
            return true;
          }}
          confirmationDisabled={
            uncertain ||
            !ready ||
            (!!editor && (!editorReady || stale)) ||
            action.basis !== reviewBasis ||
            action.epoch !== scope.version
          }
          summary={
            <div className="space-y-3">
              {proposed && (
                <dl className="grid gap-2 text-sm">
                  {[
                    ['code', proposed.code],
                    [
                      'type',
                      label(proposed.discountType === 'percentage' ? 'percentage' : 'fixed'),
                    ],
                    [
                      proposed.discountType === 'percentage' ? 'percent' : 'amount',
                      proposed.discountType === 'percentage'
                        ? numbers.percent(Number(proposed.discountValue) / 10000)
                        : money(proposed.discountValue),
                    ],
                    ...(proposed.maxCapIrr ? [['cap', money(proposed.maxCapIrr)]] : []),
                    ['minimum', money(proposed.minOrderAmount)],
                    [
                      'eligibility',
                      label(proposed.eligibility === 'profile' ? 'restricted' : 'public'),
                    ],
                    ['categories', categories(proposed.categories)],
                    [
                      'totalLimit',
                      proposed.totalLimit === null
                        ? label('unlimited')
                        : numbers.number(proposed.totalLimit),
                    ],
                    [
                      'perProfileLimit',
                      proposed.perProfileLimit === null
                        ? label('unlimited')
                        : numbers.number(proposed.perProfileLimit),
                    ],
                    [
                      'start',
                      proposed.validFrom ? formatDate(proposed.validFrom) : label('immediate'),
                    ],
                    [
                      'end',
                      proposed.validUntil ? formatDate(proposed.validUntil) : label('noExpiry'),
                    ],
                    [
                      'restorationPolicy',
                      label(
                        !proposed.restoreOnCancel
                          ? 'noRestoration'
                          : proposed.restoreAfterPayment
                            ? 'restorePaid'
                            : 'restoreUnpaid'
                      ),
                    ],
                  ].map(([key, value]) => (
                    <div key={key}>
                      <dt>{label(key!)}</dt>
                      <dd dir="auto">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {currentBasis && (
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">{label('discount')}</dt>
                    <dd>{discount(currentBasis)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{label('categories')}</dt>
                    <dd>{categories(currentBasis.categories)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{label('eligibility')}</dt>
                    <dd>
                      {label(currentBasis.eligibility === 'profile' ? 'restricted' : 'public')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{label('consumed')}</dt>
                    <dd>{numbers.number(currentBasis.usage.consumed)}</dd>
                  </div>
                </dl>
              )}
              {recovery(true)}
            </div>
          }
          finalFocus={() => refreshButton.current}
          onSuccess={async (result) => {
            if (
              scope.live.current !== action.epoch ||
              liveReview.current.action !== action ||
              liveReview.current.basis !== action.basis ||
              liveReview.current.queryScope !== action.queryScope
            )
              throw new Error('Obsolete gift receipt');
            if (!matchesGiftReceipt(result, action.body, action.id))
              throw new Error('Invalid gift receipt');
            if (!record) catalogue.accept(result);
            if (!workspace) setEditor(null);
            setDraft(null);
            setDraftBasis(null);
            setAction(null);
            owner.current = null;
            sending.current = false;
            setPending(false);
            setUncertain(false);
            if (record) {
              if (showDetail) {
                if (stats) detail.accept({ ...stats, code: result });
                detail.retry();
                setSaved(true);
              } else {
                toast.success(label('saved'));
                record.goToRecord(result.id, true);
              }
            } else {
              setSaved(true);
              catalogue.retry();
            }
          }}
        />
      )}
    </div>
  );
}
