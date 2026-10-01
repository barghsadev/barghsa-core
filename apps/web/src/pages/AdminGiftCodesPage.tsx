import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, DatePicker, datePickerAtTime, Input, Label, ListPage } from '@barghsa/ui';
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
type DateField = {
  date: Date | undefined;
  time: string;
  original: string | null;
  changed: boolean;
};
type Draft = {
  code: string;
  discountType: 'fixed_irr' | 'percentage';
  value: string;
  cap: string;
  eligibility: 'public' | 'profile';
  profileIds: string[];
  totalLimit: string;
  perProfileLimit: string;
  minimum: string;
  categories: string[];
  restoreOnCancel: boolean;
  restoreAfterPayment: boolean;
  start: DateField;
  end: DateField;
};
function dateField(value: string | null, zone: string): DateField {
  const date = value ? new Date(value) : undefined;
  return {
    date,
    time: date
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: zone,
          hourCycle: 'h23',
          hour: '2-digit',
          minute: '2-digit',
        }).format(date)
      : '00:00',
    original: value,
    changed: false,
  };
}
function instant(field: DateField, zone: string): string | null {
  if (!field.date) return null;
  if (!field.changed && field.original) return field.original;
  const match = /^(\d{2}):(\d{2})$/.exec(field.time);
  if (!match) throw new Error('Invalid time');
  const date = datePickerAtTime(field.date, Number(match[1]), Number(match[2]), zone);
  if (!date) throw new Error('Invalid time');
  return date.toISOString();
}
function draftFrom(row: GiftCodeDto | undefined, zone: string): Draft {
  return {
    code: row?.code ?? '',
    discountType: row?.discountType ?? 'fixed_irr',
    value: row
      ? row.discountType === 'percentage'
        ? String(Number(row.discountValue) / 100)
        : row.discountValue
      : '',
    cap: row?.maxCapIrr ?? '',
    eligibility: row?.eligibility ?? 'public',
    profileIds: row?.profileIds ?? [],
    totalLimit: row?.totalLimit?.toString() ?? '',
    perProfileLimit: row?.perProfileLimit?.toString() ?? '',
    minimum: row?.minOrderAmount ?? '0',
    categories: row?.categories ?? [],
    restoreOnCancel: row?.restoreOnCancel ?? true,
    restoreAfterPayment: row?.restoreAfterPayment ?? false,
    start: dateField(row?.validFrom ?? null, zone),
    end: dateField(row?.validUntil ?? null, zone),
  };
}
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
  const [draft, setDraft] = useState<Draft | null>(null),
    [draftBasis, setDraftBasis] = useState<string | null>(null),
    [localEditor, setEditor] = useState<string | null>(null);
  const [action, setAction] = useState<GiftReview | null>(null),
    [saved, setSaved] = useState(false),
    [invalidDate, setInvalidDate] = useState(false);
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
    setInvalidDate(false);
  }, []);
  const scope = useCatalogueScope(clearPrivate);
  const catalogue = useGiftCodeCatalogue(scope, filter, preference.status === 'ready', queries);
  const editor = scope.denied ? null : selection ? selection.id || null : localEditor;
  const [editorScope, setEditorScope] = useState(editor);
  if (editorScope !== editor) {
    setEditorScope(editor);
    setDraft(null);
    setDraftBasis(null);
    setAction(null);
    setInvalidDate(false);
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
    )
      setAction(null);
  }, [action, reviewBasis, scope.version, queryScope]);
  const refresh = () => {
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
          dialog && (catalogue.loading || detail.loading || preference.status === 'loading')
        }
        onClick={refresh}
      >
        {label('refresh')}
      </Button>
      {dialog && (catalogue.error || detail.error) && <p role="alert">{label('error')}</p>}
    </div>
  );
  function choose(value: string | null) {
    if (preference.status === 'error') preference.retry();
    setDraft(null);
    setDraftBasis(null);
    setInvalidDate(false);
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
    if (!ready || action || (editor && (!editorReady || stale))) return;
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
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !editor || !editorReady || stale || action) return;
    let start: string | null, end: string | null;
    try {
      start = instant(draft.start, zone);
      end = instant(draft.end, zone);
      if (editor !== 'new' && !start) throw new Error('Missing start');
      if (end && Date.parse(end) <= Date.parse(start ?? new Date().toISOString()))
        throw new Error('Invalid window');
    } catch {
      setInvalidDate(true);
      return;
    }
    setInvalidDate(false);
    propose(
      `/api/admin/promotions/gift-codes${editor === 'new' ? '' : `/${editor}`}`,
      editor === 'new' ? 'POST' : 'PATCH',
      label('save'),
      label('confirmSave'),
      {
        code: draft.code.trim(),
        discountType: draft.discountType,
        discountValue:
          draft.discountType === 'percentage'
            ? String(Math.round(Number(draft.value) * 100))
            : draft.value,
        maxCapIrr: draft.discountType === 'percentage' ? draft.cap : null,
        eligibility: draft.eligibility,
        profileIds: draft.eligibility === 'profile' ? draft.profileIds : [],
        totalLimit: draft.totalLimit === '' ? null : Number(draft.totalLimit),
        perProfileLimit: draft.perProfileLimit === '' ? null : Number(draft.perProfileLimit),
        minOrderAmount: draft.minimum,
        categories: draft.categories,
        restoreOnCancel: draft.restoreOnCancel,
        restoreAfterPayment: draft.restoreAfterPayment,
        ...(start ? { validFrom: start } : {}),
        validUntil: end,
      }
    );
  }
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
                id="gift-search"
                maxLength={64}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor="gift-status-filter">{label('status')}</Label>
              <select
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
            <Button type="submit" variant="outline">
              {label('search')}
            </Button>
          </form>
        </ListPage.Toolbar>
        {saved && <p role="status">{label('saved')}</p>}
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
                <Button disabled={!ready || !!action} onClick={() => choose('new')}>
                  {label('add')}
                </Button>
              </div>
              {editor && editor !== 'new' && (
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={detail.loading}
                    onClick={detail.retry}
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
                      <Button type="button" variant="outline" onClick={detail.retry}>
                        {label('retry')}
                      </Button>
                    </p>
                  )}
                </div>
              )}
              {draft && (
                <form
                  aria-label={label('editor')}
                  onSubmit={save}
                  className="flex flex-col gap-4 border-y py-5"
                >
                  {stale && <p role="alert">{label('stale')}</p>}
                  <fieldset disabled={!!action} className="min-w-0 space-y-4">
                    <div>
                      <Label htmlFor="gift-code">{label('code')}</Label>
                      <Input
                        id="gift-code"
                        dir="ltr"
                        required
                        maxLength={64}
                        value={draft.code}
                        onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                      />
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                      <Label htmlFor="gift-type">{label('type')}</Label>
                      <select
                        id="gift-type"
                        className="max-w-full rounded-md border bg-background p-2"
                        value={draft.discountType}
                        onChange={(event) =>
                          setDraft({
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
                    </div>
                    <div>
                      <Label htmlFor="gift-value">
                        {label(draft.discountType === 'percentage' ? 'percent' : 'amount')}
                      </Label>
                      <Input
                        id="gift-value"
                        required
                        {...(draft.discountType === 'percentage'
                          ? { type: 'number', min: '0.01', max: '100', step: '0.01' }
                          : { inputMode: 'numeric', pattern: '[1-9][0-9]{0,18}', maxLength: 19 })}
                        value={draft.value}
                        onChange={(event) => setDraft({ ...draft, value: event.target.value })}
                      />
                    </div>
                    {draft.discountType === 'percentage' && (
                      <>
                        <div>
                          <Label htmlFor="gift-cap">{label('cap')}</Label>
                          <Input
                            id="gift-cap"
                            required
                            inputMode="numeric"
                            pattern="[1-9][0-9]{0,18}"
                            maxLength={19}
                            value={draft.cap}
                            onChange={(event) => setDraft({ ...draft, cap: event.target.value })}
                          />
                        </div>
                        <p role="note" className="rounded-md border p-3">
                          {label('percentageWarning')}
                        </p>
                      </>
                    )}
                    <div className="flex min-w-0 flex-col gap-2">
                      <Label htmlFor="gift-eligibility">{label('eligibility')}</Label>
                      <select
                        id="gift-eligibility"
                        className="max-w-full rounded-md border bg-background p-2"
                        value={draft.eligibility}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            eligibility: event.target.value as Draft['eligibility'],
                            profileIds: [],
                          })
                        }
                      >
                        <option value="public">{label('public')}</option>
                        <option value="profile">{label('restricted')}</option>
                      </select>
                    </div>
                    {draft.eligibility === 'profile' && (
                      <GiftProfilePicker
                        ids={draft.profileIds}
                        onChange={(profileIds) => setDraft({ ...draft, profileIds })}
                        onDenied={scope.deny}
                        label={label}
                      />
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(['totalLimit', 'perProfileLimit'] as const).map((field) => (
                        <div key={field}>
                          <Label htmlFor={`gift-${field}`}>{label(field)}</Label>
                          <Input
                            id={`gift-${field}`}
                            type="number"
                            min="1"
                            max="2147483647"
                            step="1"
                            placeholder={label('unlimited')}
                            value={draft[field]}
                            onChange={(event) =>
                              setDraft({ ...draft, [field]: event.target.value })
                            }
                          />
                        </div>
                      ))}
                    </div>
                    <div>
                      <Label htmlFor="gift-minimum">{label('minimum')}</Label>
                      <Input
                        id="gift-minimum"
                        inputMode="numeric"
                        pattern="[0-9]{1,19}"
                        maxLength={19}
                        required
                        value={draft.minimum}
                        onChange={(event) => setDraft({ ...draft, minimum: event.target.value })}
                      />
                    </div>
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
                                setDraft({
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
                    <fieldset className="rounded-md border p-4">
                      <legend className="px-1 font-semibold">{label('restorationPolicy')}</legend>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={draft.restoreOnCancel}
                          onChange={(event) =>
                            setDraft({
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
                            setDraft({ ...draft, restoreAfterPayment: event.target.checked })
                          }
                        />
                        {label('restoreAfterPayment')}
                      </label>
                    </fieldset>
                    <p className="text-sm">
                      {label('timezone')}: <bdi>{zone}</bdi>
                    </p>
                    {(['start', 'end'] as const).map((field) => (
                      <fieldset key={field} className="rounded-md border p-4">
                        <legend className="px-1 font-semibold">{label(field)}</legend>
                        {(field === 'end' || editor === 'new') && (
                          <label className="mb-3 flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={Boolean(draft[field].date)}
                              onChange={(event) =>
                                setDraft({
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
                                setDraft({
                                  ...draft,
                                  [field]: { ...draft[field], date, changed: true },
                                })
                              }
                            />
                            <div>
                              <Label htmlFor={`gift-${field}-time`}>{label(`${field}Time`)}</Label>
                              <Input
                                id={`gift-${field}-time`}
                                type="time"
                                required
                                value={draft[field].time}
                                onChange={(event) =>
                                  setDraft({
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
                    ))}
                    {invalidDate && <p role="alert">{label('invalidDate')}</p>}
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        disabled={
                          !editorReady ||
                          stale ||
                          !draft.code.trim() ||
                          (draft.eligibility === 'profile' && !draft.profileIds.length) ||
                          (editor !== 'new' && !draft.start.date)
                        }
                      >
                        {label('save')}
                      </Button>
                      {stale && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!editorReady}
                          onClick={() => {
                            setDraft(draftFrom(stats?.code, zone));
                            setDraftBasis(editorBasis);
                            setInvalidDate(false);
                          }}
                        >
                          {label('reset')}
                        </Button>
                      )}
                      <Button type="button" variant="outline" onClick={() => choose(null)}>
                        {label('cancel')}
                      </Button>
                    </div>
                  </fieldset>
                </form>
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
                          disabled={!ready || !!action}
                          aria-label={`${label('edit')} ${row.code}`}
                          onClick={() => choose(row.id)}
                        >
                          {label('edit')}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!ready || !!action}
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
                loading={catalogue.more === 'loading'}
                onNext={() => void catalogue.loadMore()}
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
          onClose={() => setAction(null)}
          onDenied={scope.deny}
          confirmationDisabled={
            !ready ||
            (!!editor && (!editorReady || stale)) ||
            action.basis !== reviewBasis ||
            action.epoch !== scope.version
          }
          summary={recovery(true)}
          finalFocus={() => refreshButton.current}
          onSuccess={async (result) => {
            if (
              scope.live.current !== action.epoch ||
              liveReview.current.action !== action ||
              liveReview.current.basis !== action.basis ||
              liveReview.current.queryScope !== action.queryScope
            )
              return;
            if (!matchesGiftReceipt(result, action.body, action.id))
              throw new Error('Invalid gift receipt');
            catalogue.accept(result);
            if (selection) selection.set('');
            else setEditor(null);
            setDraft(null);
            setDraftBasis(null);
            setAction(null);
            setSaved(true);
            catalogue.retry();
          }}
        />
      )}
    </div>
  );
}
