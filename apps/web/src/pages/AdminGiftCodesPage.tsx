import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, DatePicker, Input, Label, ListPage } from '@barghsa/ui';
import { tGift } from '@barghsa/i18n/gifts';
import { GIFT_CODE_CATEGORIES, type GiftCodeDto } from '@barghsa/shared/promotions';
import { formatInTimezone } from '@barghsa/i18n/date-time';
import { useTimezone } from '../hooks/useTimezone.js';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { GiftProfilePicker } from '../components/GiftProfilePicker.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useGiftCodeCatalogue } from '../hooks/useGiftCodeCatalogue.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { giftFilter } from '../lib/gift-list-query.js';
import {
  Form,
  FormInput,
  FormField,
  FormItem,
  FormControl,
  FormMessage,
  FormSubmit,
  useZodForm,
} from '@barghsa/ui/form';
import {
  giftDraftFrom as draftFrom,
  giftDateField as dateField,
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
export default function AdminGiftCodesPage({
  queries,
  selection,
}: {
  queries?: ListQueryBinding;
  selection?: {
    id: string;
    set: (id: string) => void;
    apply: (filters: Record<string, string>) => void;
  };
} = {}) {
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
            <FormMessage reserveSpace />
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
  const catalogue = useGiftCodeCatalogue(scope, filter, preference.status === 'ready', queries);
  const editor = scope.denied ? null : selection ? selection.id || null : localEditor;
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
    validateStats
  );
  const rows = catalogue.rows ?? [],
    stats = detail.data;
  const zone = preference.timezone;
  const formatDate = (value: string) =>
    formatInTimezone(value, zone, locale, { dateStyle: 'medium', timeStyle: 'short' });
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
    catalogue.rows !== null &&
    !catalogue.loading &&
    !catalogue.pending;
  const editorReady =
    ready &&
    (editor === 'new' ||
      (!!stats &&
        !detail.loading &&
        !detail.error &&
        (!selected || Date.parse(selected.updatedAt) <= Date.parse(stats.code.updatedAt))));
  const currentBasis =
    action?.id && action.path.endsWith('/toggle') ? rows.find((r) => r.id === action.id) : null;
  const reviewBasis = currentBasis ? giftCodeBasis(currentBasis) : editor ? editorBasis : null;
  const liveReview = useRef({ action, basis: reviewBasis, queryScope });
  liveReview.current = { action, basis: reviewBasis, queryScope };
  useEffect(() => {
    if (editor && !draft && editorReady) {
      setDraft(draftFrom(stats?.code, zone));
      setDraftBasis(editorBasis);
    }
  }, [editor, draft, editorReady, stats, zone, editorBasis]);
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
      catalogue.retry();
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
        {label('refresh')}
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
    if (selection) selection.set(value || '');
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
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      <ListPage>
        <ListPage.Toolbar>
          {recovery()}
          <form
            aria-label={label('filters')}
            className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-3"
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
                if (selection) selection.apply(filters);
                else queries.setQuery({ filters, cursor: '' });
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
            <div>
              <Label htmlFor="gift-search">{label('searchCode')}</Label>
              <Input
                disabled={locked}
                id="gift-search"
                maxLength={64}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor="gift-status-filter">{label('status')}</Label>
              <select
                disabled={locked}
                id="gift-status-filter"
                className="max-w-full rounded-md border bg-background p-2"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">{label('all')}</option>
                <option value="active">{label('active')}</option>
                <option value="inactive">{label('inactive')}</option>
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor="gift-type-filter">{label('type')}</Label>
              <select
                disabled={locked}
                id="gift-type-filter"
                className="max-w-full rounded-md border bg-background p-2"
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                <option value="">{label('all')}</option>
                <option value="fixed_irr">{label('fixed')}</option>
                <option value="percentage">{label('percentage')}</option>
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor="gift-eligibility-filter">{label('eligibility')}</Label>
              <select
                disabled={locked}
                id="gift-eligibility-filter"
                className="max-w-full rounded-md border bg-background p-2"
                value={eligibility}
                onChange={(event) => setEligibility(event.target.value)}
              >
                <option value="">{label('all')}</option>
                <option value="public">{label('public')}</option>
                <option value="profile">{label('restricted')}</option>
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor="gift-expiry-filter">{label('expiry')}</Label>
              <select
                disabled={locked}
                id="gift-expiry-filter"
                className="max-w-full rounded-md border bg-background p-2"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
              >
                <option value="">{label('all')}</option>
                <option value="not_expired">{label('notExpired')}</option>
                <option value="expired">{label('expired')}</option>
              </select>
            </div>
            <Button type="submit" variant="outline" disabled={locked}>
              {label('search')}
            </Button>
          </form>
        </ListPage.Toolbar>
        {saved && <p role="status">{label('saved')}</p>}
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
          retainContent={catalogue.rows !== null}
          loadingView={<p role="status">{label('loading')}</p>}
          errorView={<p role="alert">{scope.denied ? label('denied') : label('error')}</p>}
        >
          {catalogue.rows !== null && !scope.denied && (
            <>
              <div>
                <Button disabled={!ready || locked} onClick={() => choose('new')}>
                  {label('add')}
                </Button>
              </div>
              {editor && editor !== 'new' && (
                <div className="space-y-2">
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
                  {!draft && (
                    <Button type="button" variant="outline" onClick={() => choose(null)}>
                      {label('cancel')}
                    </Button>
                  )}
                  {detail.loading && <p role="status">{label('loading')}</p>}
                  {detail.error && (
                    <p role="alert">
                      {label('statsError')}{' '}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          if (!sending.current) detail.retry();
                        }}
                      >
                        {label('retry')}
                      </Button>
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
                    className="flex flex-col gap-4 border-y py-5"
                  >
                    {stale && <p role="alert">{label('stale')}</p>}
                    <fieldset disabled={locked} className="min-w-0 space-y-4">
                      <FormInput
                        control={form.control}
                        name="code"
                        id="gift-code"
                        label={label('code')}
                        disabled={locked}
                        inputProps={{ dir: 'ltr', maxLength: 64 }}
                      />
                      <FormField
                        control={form.control}
                        name="discountType"
                        render={({ field }) => (
                          <FormItem id="gift-type">
                            <Label htmlFor="gift-type">{label('type')}</Label>
                            <FormControl>
                              <select
                                id="gift-type"
                                name={field.name}
                                ref={field.ref}
                                onBlur={field.onBlur}
                                disabled={locked}
                                className="max-w-full rounded-md border bg-background p-2"
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
                              </select>
                            </FormControl>
                            <FormMessage reserveSpace />
                          </FormItem>
                        )}
                      />
                      <FormInput
                        control={form.control}
                        name="value"
                        id="gift-value"
                        label={label(draft.discountType === 'percentage' ? 'percent' : 'amount')}
                        disabled={locked}
                        inputProps={{
                          inputMode: draft.discountType === 'percentage' ? 'decimal' : 'numeric',
                          maxLength: 19,
                          dir: 'ltr',
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
                            inputProps={{ inputMode: 'numeric', maxLength: 19, dir: 'ltr' }}
                          />
                          <p role="note" className="rounded-md border p-3">
                            {label('percentageWarning')}
                          </p>
                        </>
                      )}
                      <FormField
                        control={form.control}
                        name="eligibility"
                        render={({ field }) => (
                          <FormItem id="gift-eligibility">
                            <Label htmlFor="gift-eligibility">{label('eligibility')}</Label>
                            <FormControl>
                              <select
                                id="gift-eligibility"
                                name={field.name}
                                ref={field.ref}
                                onBlur={field.onBlur}
                                disabled={locked}
                                className="max-w-full rounded-md border bg-background p-2"
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
                              </select>
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
                      <div className="grid gap-4 sm:grid-cols-2">
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
                      </div>
                      <FormInput
                        control={form.control}
                        name="minimum"
                        id="gift-minimum"
                        label={label('minimum')}
                        disabled={locked}
                        inputProps={{ inputMode: 'numeric', maxLength: 19, dir: 'ltr' }}
                      />
                      {group(
                        'categories',
                        <fieldset className="rounded-md border p-4">
                          <legend className="px-1 font-semibold">{label('categories')}</legend>
                          <p className="mb-3 text-sm text-muted-foreground">
                            {label('categoriesHelp')}
                          </p>
                          <div className="flex flex-wrap gap-4">
                            {GIFT_CODE_CATEGORIES.map((category) => (
                              <label key={category} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
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
                      {group(
                        'restoreAfterPayment',
                        <fieldset className="rounded-md border p-4">
                          <legend className="px-1 font-semibold">
                            {label('restorationPolicy')}
                          </legend>
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
                          <label className="mt-3 flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={draft.restoreAfterPayment}
                              disabled={!draft.restoreOnCancel}
                              onChange={(event) =>
                                updateDraft({ ...draft, restoreAfterPayment: event.target.checked })
                              }
                            />
                            {label('restoreAfterPayment')}
                          </label>
                        </fieldset>
                      )}
                      <p className="text-sm">
                        {label('timezone')}: <bdi>{zone}</bdi>
                      </p>
                      {(['start', 'end'] as const).map((field) =>
                        group(
                          field,
                          <fieldset key={field} className="rounded-md border p-4">
                            <legend className="px-1 font-semibold">{label(field)}</legend>
                            {(field === 'end' || editor === 'new') && (
                              <label className="mb-3 flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(draft[field].date)}
                                  onChange={(event) =>
                                    updateDraft({
                                      ...draft,
                                      [field]: {
                                        ...dateField(
                                          event.target.checked ? new Date().toISOString() : null,
                                          zone
                                        ),
                                        changed: true,
                                      },
                                    })
                                  }
                                />
                                {label(field === 'start' ? 'setStart' : 'setEnd')}
                              </label>
                            )}
                            {draft[field].date ? (
                              <div className="grid gap-4 sm:grid-cols-2">
                                <DatePicker
                                  label={label(`${field}Date`)}
                                  placeholder={label('chooseDate')}
                                  locale={locale}
                                  timezone={zone}
                                  value={draft[field].date}
                                  onChange={(date) =>
                                    updateDraft({
                                      ...draft,
                                      [field]: { ...draft[field], date, changed: true },
                                    })
                                  }
                                />
                                <div>
                                  <Label htmlFor={`gift-${field}-time`}>
                                    {label(`${field}Time`)}
                                  </Label>
                                  <Input
                                    id={`gift-${field}-time`}
                                    type="time"
                                    required
                                    value={draft[field].time}
                                    onChange={(event) =>
                                      updateDraft({
                                        ...draft,
                                        [field]: {
                                          ...draft[field],
                                          time: event.target.value,
                                          changed: true,
                                        },
                                      })
                                    }
                                  />
                                </div>
                              </div>
                            ) : (
                              <p>{label(field === 'start' ? 'immediate' : 'noExpiry')}</p>
                            )}
                          </fieldset>
                        )
                      )}
                      {form.formState.errors.root?.validation?.message && (
                        <p role="alert">{form.formState.errors.root.validation.message}</p>
                      )}
                      <div className="flex gap-2">
                        <FormSubmit loading={validating} disabled={locked || !editorReady || stale}>
                          {label('save')}
                        </FormSubmit>
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
                      </div>
                    </fieldset>
                  </form>
                </Form>
              )}
              {stats && (
                <section
                  aria-label={label('usageStats')}
                  className="space-y-4 rounded-md border p-4"
                >
                  <h2 className="text-lg font-semibold">
                    {label('usageStats')}: <bdi>{stats.code.code}</bdi>
                  </h2>
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
              {!rows.length && <p>{label('empty')}</p>}
              <ul className="divide-y">
                {rows.map((row) => (
                  <li key={row.id} className="flex flex-col gap-3 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h2 className="break-all font-semibold" dir="ltr">
                        {row.code}
                      </h2>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          disabled={!ready || locked}
                          aria-label={`${label('edit')} ${row.code}`}
                          onClick={() => choose(row.id)}
                        >
                          {label('edit')}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!ready || locked}
                          aria-label={`${label(row.status === 'active' ? 'deactivate' : 'activate')} ${row.code}`}
                          onClick={() =>
                            propose(
                              `/api/admin/promotions/gift-codes/${row.id}/toggle`,
                              'POST',
                              label(row.status === 'active' ? 'deactivate' : 'activate'),
                              `${row.code}. ${label('confirmStatus')}`,
                              { status: row.status === 'active' ? 'inactive' : 'active' },
                              row
                            )
                          }
                        >
                          {label(row.status === 'active' ? 'deactivate' : 'activate')}
                        </Button>
                      </div>
                    </div>
                    <p>
                      {label(row.status)} ·{' '}
                      {label(row.eligibility === 'profile' ? 'restricted' : 'public')}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {label(
                        !row.restoreOnCancel
                          ? 'noRestoration'
                          : row.restoreAfterPayment
                            ? 'restorePaid'
                            : 'restoreUnpaid'
                      )}
                    </p>
                    <p>
                      {row.discountType === 'percentage'
                        ? `${numbers.percent(Number(row.discountValue) / 10000)} · ${label('cap')}: ${money(row.maxCapIrr!)}`
                        : money(row.discountValue)}
                    </p>
                    <dl className="grid gap-2 text-sm sm:grid-cols-3">
                      {[
                        ['consumed', numbers.number(row.usage.consumed)],
                        ['released', numbers.number(row.usage.released)],
                        ['totalDiscount', money(row.usage.totalDiscountIrr)],
                      ].map(([key, value]) => (
                        <div key={key}>
                          <dt>{label(key!)}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
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
            catalogue.retry();
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
            catalogue.accept(result);
            if (selection) selection.set('');
            else setEditor(null);
            setDraft(null);
            setDraftBasis(null);
            setAction(null);
            owner.current = null;
            sending.current = false;
            setPending(false);
            setUncertain(false);
            setSaved(true);
            catalogue.retry();
          }}
        />
      )}
    </div>
  );
}
