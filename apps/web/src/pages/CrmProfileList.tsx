import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Building2, UserRound } from 'lucide-react';
import { useSearch } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/crm';
import {
  Button,
  Input,
  Label,
  DatePicker,
  datePickerCalendarDate,
  datePickerDayBounds,
} from '@barghsa/ui';
import { useTimezone } from '../hooks/useTimezone.js';
import { useLocale } from '../hooks/useLocale.js';
interface User {
  userId: string;
  username: string;
  registrationDate: string;
  lastLogin: string | null;
  profileCount: number;
  hasVerifiedProfile: boolean;
  profiles: { id: string; profileType: string; status: string; title: string | null }[];
}
const emptyFilters = {
  type: '',
  verification: '',
  dateFrom: '',
  dateTo: '',
  sort: 'createdAt',
  order: 'desc',
  staffOnly: false,
};
export default function CrmProfileList() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const preference = useTimezone();
  const search = useSearch({ from: '/admin/crm/' });
  const [filters, setFilters] = useState({
    ...emptyFilters,
    verification: ['VERIFIED', 'UNVERIFIED', 'PENDING', 'DISABLED'].includes(
      search.verification ?? ''
    )
      ? search.verification!
      : '',
  });
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [cursors, setCursors] = useState<string[]>(['']);
  const [result, setResult] = useState<{
    users: User[];
    cursor: string | null;
    hasMore: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const generation = useRef(0);
  const sortFocus = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const sort = sortFocus.current;
    sortFocus.current = null;
    if (sort && document.activeElement === document.body)
      document.getElementById('crm-sort-' + sort)?.focus();
  }, [loading, result]);
  useEffect(() => {
    if (text.trim() === term) return;
    const timer = setTimeout(() => {
      setTerm(text.trim());
      setCursors(['']);
    }, 300);
    return () => clearTimeout(timer);
  }, [text, term]);
  useEffect(() => {
    setCursors(['']);
  }, [preference.timezone]);
  const cursor = cursors.at(-1) ?? '';
  const load = useCallback(async () => {
    const current = ++generation.current;
    if (preference.status !== 'ready') {
      setLoading(false);
      setResult(null);
      return;
    }
    setLoading(true);
    setError(false);
    setResult(null);
    setExpanded({});
    const params = new URLSearchParams({ limit: '20', order: filters.order });
    for (const [key, value] of Object.entries({ ...filters, search: term, cursor })) {
      if (value) params.set(key, String(value));
    }
    for (const key of ['dateFrom', 'dateTo'] as const) {
      const selected = datePickerCalendarDate(filters[key], preference.timezone);
      if (!selected) continue;
      const { start, end } = datePickerDayBounds(selected, preference.timezone);
      // PostgreSQL records microseconds; retain the entire inclusive final day.
      params.set(
        key,
        key === 'dateFrom' ? start.toISOString() : end.toISOString().replace('.999Z', '.999999Z')
      );
    }
    try {
      const response = await fetch(`/api/crm/users?${params}`, { credentials: 'include' });
      if (!response.ok) throw new Error('CRM unavailable');
      const data = await response.json();
      if (
        !data ||
        !Array.isArray(data.users) ||
        typeof data.hasMore !== 'boolean' ||
        !(data.cursor === null || (typeof data.cursor === 'string' && data.cursor.length > 0)) ||
        data.hasMore !== (data.cursor !== null) ||
        (data.hasMore && data.users.length === 0) ||
        !data.users.every(
          (user: User) =>
            user &&
            typeof user.userId === 'string' &&
            typeof user.username === 'string' &&
            typeof user.registrationDate === 'string' &&
            Number.isFinite(Date.parse(user.registrationDate)) &&
            (user.lastLogin === null ||
              (typeof user.lastLogin === 'string' &&
                Number.isFinite(Date.parse(user.lastLogin)))) &&
            Number.isSafeInteger(user.profileCount) &&
            user.profileCount >= 0 &&
            typeof user.hasVerifiedProfile === 'boolean' &&
            Array.isArray(user.profiles) &&
            user.profiles.length === user.profileCount &&
            user.profiles.every(
              (profile) =>
                profile &&
                typeof profile.id === 'string' &&
                ['LEGAL', 'INDIVIDUAL'].includes(profile.profileType) &&
                typeof profile.status === 'string' &&
                (profile.title === null || typeof profile.title === 'string')
            )
        )
      )
        throw new Error('Invalid CRM response');
      if (current === generation.current) setResult(data);
    } catch {
      if (current === generation.current) setError(true);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [filters, term, cursor, preference.status, preference.timezone]);
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
    };
  }, [load]);
  function update(key: keyof typeof filters, value: string | boolean) {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setCursors(['']);
  }
  function date(value: string | null) {
    return value
      ? new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
          dateStyle: 'medium',
          timeZone: preference.timezone,
        }).format(new Date(value))
      : '—';
  }
  return (
    <section className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-semibold">{t('crm.list.title', locale)}</h1>
      <div className="grid gap-4 rounded-lg border bg-card text-card-foreground p-4 sm:grid-cols-2 xl:grid-cols-3">
        <div>
          <Label htmlFor="crm-search">{t('crm.list.search', locale)}</Label>
          <Input id="crm-search" value={text} onChange={(event) => setText(event.target.value)} />
        </div>
        {(
          [
            { key: 'type', options: ['', 'INDIVIDUAL', 'LEGAL'] },
            { key: 'verification', options: ['', 'VERIFIED', 'UNVERIFIED', 'PENDING', 'DISABLED'] },
            { key: 'order', options: ['desc', 'asc'] },
          ] as const
        ).map(({ key, options }) => (
          <div key={key}>
            <Label htmlFor={`crm-${key}`}>{t(`crm.list.${key}`, locale)}</Label>
            <select
              id={`crm-${key}`}
              className="block w-full rounded border border-input bg-background text-foreground p-2"
              value={filters[key]}
              onChange={(event) => update(key, event.target.value)}
            >
              {options.map((value) => (
                <option key={value} value={value}>
                  {t(
                    `crm.list.${key === 'order' ? (value === 'asc' ? 'sortAscending' : 'sortDescending') : value || 'all'}`,
                    locale
                  )}
                </option>
              ))}
            </select>
          </div>
        ))}
        {(['dateFrom', 'dateTo'] as const).map((key) => (
          <div key={key}>
            <Label htmlFor={`crm-${key}`}>
              {t(`crm.list.${key === 'dateFrom' ? 'from' : 'to'}`, locale)}
            </Label>
            <DatePicker
              id={`crm-${key}`}
              label={t(`crm.list.${key === 'dateFrom' ? 'from' : 'to'}`, locale)}
              placeholder={t(`crm.list.${key === 'dateFrom' ? 'from' : 'to'}`, locale)}
              locale={locale}
              timezone={preference.timezone}
              disabled={preference.status !== 'ready'}
              {...(filters[key]
                ? { value: datePickerCalendarDate(filters[key], preference.timezone) }
                : {})}
              {...(key === 'dateTo' && filters.dateFrom
                ? { minDate: datePickerCalendarDate(filters.dateFrom, preference.timezone) }
                : {})}
              {...(key === 'dateFrom' && filters.dateTo
                ? { maxDate: datePickerCalendarDate(filters.dateTo, preference.timezone) }
                : {})}
              onChange={(value) =>
                update(
                  key,
                  value
                    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
                    : ''
                )
              }
            />
          </div>
        ))}
        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.staffOnly}
            onChange={(event) => update('staffOnly', event.target.checked)}
          />
          {t('crm.list.staffOnly', locale)}
        </Label>
      </div>
      {preference.status === 'ready' && (
        <p className="text-sm text-muted-foreground">
          {t('crm.list.timezone', locale).replace('{timezone}', preference.timezone)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setFilters(emptyFilters);
            setText('');
            setTerm('');
            setCursors(['']);
          }}
        >
          {t('crm.list.clear', locale)}
        </Button>
        <Button variant="outline" onClick={() => setExpanded({})}>
          {t('crm.list.collapse', locale)}
        </Button>
        <Button
          variant="outline"
          disabled={loading || preference.status === 'loading'}
          onClick={() => {
            if (preference.status === 'error') preference.retry();
            else void load();
          }}
        >
          {t('crm.list.refresh', locale)}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(filters)
          .filter(([key, value]) => value && key !== 'order' && key !== 'sort')
          .map(([key, value]) => (
            <Button
              key={key}
              variant="outline"
              size="sm"
              onClick={() => update(key as keyof typeof filters, key === 'staffOnly' ? false : '')}
            >
              {t(
                `crm.list.${key === 'staffOnly' ? 'staffOnly' : key === 'dateFrom' ? 'from' : key === 'dateTo' ? 'to' : String(value)}`,
                locale
              )}
              {key === 'dateFrom' || key === 'dateTo'
                ? `: ${date(datePickerCalendarDate(String(value), preference.timezone)?.toISOString() ?? null)}`
                : ''}{' '}
              ×
            </Button>
          ))}
      </div>
      {loading || preference.status === 'loading' ? (
        <p role="status">{t('crm.list.loading', locale)}</p>
      ) : error || preference.status === 'error' ? (
        <p role="alert">{t('crm.list.error', locale)}</p>
      ) : !result?.users.length ? (
        <p>{t('crm.list.empty', locale)}</p>
      ) : (
        <div
          className="overflow-x-auto rounded-lg border bg-card text-card-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll every table column.
          tabIndex={0}
          role="region"
          aria-label={t('crm.list.title', locale)}
        >
          <table className="w-full min-w-[48rem] text-start text-sm">
            <caption className="sr-only">{t('crm.list.title', locale)}</caption>
            <thead>
              <tr className="border-b">
                {[
                  ['username', 'username'],
                  ['', 'type'],
                  ['createdAt', 'registered'],
                  ['lastLogin', 'lastLogin'],
                  ['', 'verification'],
                  ['profileCount', 'profiles'],
                ].map(([sort, label]) => (
                  <th
                    key={label}
                    scope="col"
                    className="p-3 text-start font-semibold"
                    aria-sort={
                      sort
                        ? filters.sort === sort
                          ? filters.order === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                        : undefined
                    }
                  >
                    {sort ? (
                      <button
                        id={'crm-sort-' + sort}
                        type="button"
                        className="inline-flex items-center gap-1 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        onClick={() => {
                          sortFocus.current = sort;
                          setFilters((previous) => ({
                            ...previous,
                            sort: sort!,
                            order:
                              previous.sort === sort && previous.order === 'asc' ? 'desc' : 'asc',
                          }));
                          setCursors(['']);
                        }}
                      >
                        {t('crm.list.' + label, locale)}
                        {filters.sort === sort &&
                          (filters.order === 'asc' ? (
                            <ArrowUp aria-hidden="true" className="size-4" />
                          ) : (
                            <ArrowDown aria-hidden="true" className="size-4" />
                          ))}
                      </button>
                    ) : (
                      t('crm.list.' + label, locale)
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.users.map((user) => {
                const profileListId = 'profiles-' + encodeURIComponent(user.userId);
                return (
                  <Fragment key={user.userId}>
                    <tr className="border-b">
                      <th scope="row" className="p-3 text-start font-medium">
                        <span dir="auto" className="break-all">
                          {user.username}
                        </span>
                      </th>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          {(['INDIVIDUAL', 'LEGAL'] as const)
                            .filter((type) =>
                              user.profiles.some((profile) => profile.profileType === type)
                            )
                            .map((type) => (
                              <span
                                key={type}
                                className="inline-flex items-center gap-1 whitespace-nowrap"
                              >
                                {type === 'LEGAL' ? (
                                  <Building2 aria-hidden="true" className="size-4" />
                                ) : (
                                  <UserRound aria-hidden="true" className="size-4" />
                                )}
                                {t('crm.list.' + type, locale)}
                              </span>
                            ))}
                          {user.profileCount === 0 && '—'}
                        </div>
                      </td>
                      <td className="p-3">{date(user.registrationDate)}</td>
                      <td className="p-3">{date(user.lastLogin)}</td>
                      <td className="p-3">
                        {t(
                          'crm.list.' +
                            (user.hasVerifiedProfile
                              ? 'VERIFIED'
                              : user.profiles.some(
                                    (profile) => profile.status === 'PENDING_VERIFICATION'
                                  )
                                ? 'PENDING'
                                : 'UNVERIFIED'),
                          locale
                        )}
                      </td>
                      <td className="p-3">
                        <Button
                          variant="outline"
                          disabled={user.profileCount === 0}
                          aria-expanded={!!expanded[user.userId]}
                          aria-controls={profileListId}
                          onClick={() =>
                            setExpanded((previous) => ({
                              ...previous,
                              [user.userId]: !previous[user.userId],
                            }))
                          }
                        >
                          {t('crm.list.profiles', locale)}: {numbers.number(user.profileCount)}
                        </Button>
                      </td>
                    </tr>
                    {expanded[user.userId] && (
                      <tr className="border-b">
                        <td colSpan={6} className="p-3">
                          <ul
                            id={profileListId}
                            className="sticky start-0 w-fit max-w-[calc(100vw-4rem)] space-y-2 break-words"
                          >
                            {user.profiles.map((profile) => (
                              <li key={profile.id}>
                                <a
                                  className="text-blue-700 dark:text-blue-300 underline"
                                  href={'/admin/crm/profiles/' + encodeURIComponent(profile.id)}
                                >
                                  {profile.title || t('crm.list.' + profile.profileType, locale)} ·{' '}
                                  {t('crm.list.view', locale)}
                                </a>
                                <span className="ms-2">
                                  {t('crm.list.' + profile.status, locale)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <nav aria-label={t('crm.list.title', locale)} className="flex gap-2">
        <Button
          variant="outline"
          disabled={loading || cursors.length === 1}
          onClick={() => setCursors((previous) => previous.slice(0, -1))}
        >
          {t('crm.list.previous', locale)}
        </Button>
        <Button
          variant="outline"
          disabled={loading || error || !result?.hasMore || !result.cursor}
          onClick={() => {
            if (result?.cursor) setCursors((previous) => [...previous, result.cursor!]);
          }}
        >
          {t('crm.list.next', locale)}
        </Button>
      </nav>
    </section>
  );
}
