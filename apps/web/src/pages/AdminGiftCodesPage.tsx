import { useEffect, useState, type FormEvent } from 'react';
import { Button, DatePicker, Input, Label } from '@barghsa/ui';
import { tGift } from '@barghsa/i18n/gifts';
import { GIFT_CODE_CATEGORIES, type GiftCodeDto } from '@barghsa/shared/promotions';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { GiftProfilePicker } from '../components/GiftProfilePicker.js';
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
  start: DateField;
  end: DateField;
};
function dateField(value: string | null): DateField {
  const date = value ? new Date(value) : undefined;
  return {
    date,
    time: date
      ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      : '00:00',
    original: value,
    changed: false,
  };
}
function instant(field: DateField): string | null {
  if (!field.date) return null;
  if (!field.changed && field.original) return field.original;
  const match = /^(\d{2}):(\d{2})$/.exec(field.time);
  if (!match) throw new Error('Invalid time');
  const hours = Number(match[1]),
    minutes = Number(match[2]),
    date = new Date(field.date);
  date.setHours(hours, minutes, 0, 0);
  if (hours > 23 || minutes > 59 || date.getHours() !== hours || date.getMinutes() !== minutes)
    throw new Error('Invalid time');
  return date.toISOString();
}
function draftFrom(row?: GiftCodeDto): Draft {
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
    start: dateField(row?.validFrom ?? null),
    end: dateField(row?.validUntil ?? null),
  };
}
export default function AdminGiftCodesPage() {
  const locale = useLocale(),
    label = (key: string) => tGift(`admin.gifts.${key}`, locale),
    money = (value: string) => BigInt(value).toLocaleString(locale);
  const [rows, setRows] = useState<GiftCodeDto[]>([]),
    [draft, setDraft] = useState<Draft | null>(null),
    [editor, setEditor] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading'),
    [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false),
    [invalidDate, setInvalidDate] = useState(false);
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [type, setType] = useState(''),
    [filter, setFilter] = useState('');
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    const abort = new AbortController();
    setState('loading');
    setRows([]);
    setDraft(null);
    setInvalidDate(false);
    void (async () => {
      try {
        const paths = [
          `/api/admin/promotions/gift-codes${filter ? `?${filter}` : ''}`,
          ...(editor && editor !== 'new'
            ? [`/api/admin/promotions/gift-codes/${editor}/stats`]
            : []),
        ];
        const responses = await Promise.all(
          paths.map((path) => fetch(path, { signal: abort.signal }))
        );
        if (responses.some((response) => response.status === 403)) {
          if (!abort.signal.aborted) setState('denied');
          return;
        }
        if (responses.some((response) => !response.ok)) throw new Error('Load failed');
        const data = await Promise.all(responses.map((response) => response.json()));
        if (abort.signal.aborted) return;
        setRows(data[0] as GiftCodeDto[]);
        if (editor)
          setDraft(
            draftFrom(editor === 'new' ? undefined : (data[1] as { code: GiftCodeDto }).code)
          );
        setState('ready');
      } catch {
        if (!abort.signal.aborted) setState('error');
      }
    })();
    return () => abort.abort();
  }, [editor, revision, filter]);
  function choose(value: string | null) {
    setState('loading');
    setEditor(value);
    setRevision((current) => current + 1);
  }
  function propose(
    path: string,
    method: TeamAction['method'],
    title: string,
    description: string,
    body: unknown
  ) {
    setSaved(false);
    setAction({
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
    if (!draft || !editor) return;
    let start: string | null, end: string | null;
    try {
      start = instant(draft.start);
      end = instant(draft.end);
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
      <form
        aria-label={label('filters')}
        className="grid items-end gap-3 sm:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          setEditor(null);
          setState('loading');
          setFilter(
            new URLSearchParams({
              ...(search ? { search } : {}),
              ...(status ? { status } : {}),
              ...(type ? { discountType: type } : {}),
            }).toString()
          );
          setRevision((value) => value + 1);
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
        <Button type="submit" variant="outline">
          {label('search')}
        </Button>
      </form>
      {saved && <p role="status">{label('saved')}</p>}
      {state === 'loading' && <p role="status">{label('loading')}</p>}
      {state === 'error' && <p role="alert">{label('error')}</p>}
      {state === 'denied' && <p role="alert">{label('denied')}</p>}
      {state === 'ready' && (
        <>
          <div>
            <Button onClick={() => choose('new')}>{label('add')}</Button>
          </div>
          {draft && (
            <form
              aria-label={label('editor')}
              onSubmit={save}
              className="flex flex-col gap-4 border-y py-5"
            >
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
                      onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
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
                <p className="mb-3 text-sm text-muted-foreground">{label('categoriesHelp')}</p>
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
                              ...dateField(event.target.checked ? new Date().toISOString() : null),
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
                        jalali={locale === 'fa'}
                        value={draft[field].date}
                        onChange={(date) =>
                          setDraft({ ...draft, [field]: { ...draft[field], date, changed: true } })
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
                              [field]: { ...draft[field], time: event.target.value, changed: true },
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
                    !draft.code.trim() ||
                    (draft.eligibility === 'profile' && !draft.profileIds.length) ||
                    (editor !== 'new' && !draft.start.date)
                  }
                >
                  {label('save')}
                </Button>
                <Button type="button" variant="outline" onClick={() => choose(null)}>
                  {label('cancel')}
                </Button>
              </div>
            </form>
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
                      aria-label={`${label('edit')} ${row.code}`}
                      onClick={() => choose(row.id)}
                    >
                      {label('edit')}
                    </Button>
                    <Button
                      variant="outline"
                      aria-label={`${label(row.status === 'active' ? 'deactivate' : 'activate')} ${row.code}`}
                      onClick={() =>
                        propose(
                          `/api/admin/promotions/gift-codes/${row.id}/toggle`,
                          'POST',
                          label(row.status === 'active' ? 'deactivate' : 'activate'),
                          `${row.code}. ${label('confirmStatus')}`,
                          { status: row.status === 'active' ? 'inactive' : 'active' }
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
                <p>
                  {row.discountType === 'percentage'
                    ? `${(Number(row.discountValue) / 100).toLocaleString(locale)}% · ${label('cap')}: ${money(row.maxCapIrr!)}`
                    : `${money(row.discountValue)} ${label('irr')}`}
                </p>
                <dl className="grid gap-2 text-sm sm:grid-cols-3">
                  {[
                    ['consumed', row.usage.consumed.toLocaleString(locale)],
                    ['released', row.usage.released.toLocaleString(locale)],
                    ['totalDiscount', `${money(row.usage.totalDiscountIrr)} ${label('irr')}`],
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
        </>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setEditor(null);
            setSaved(true);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
