import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Building2, UserRound } from 'lucide-react';
import { useSearch } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/crm';
import {
  Button,
  Input,
  Label,
  DatePicker,
  ListPage,
  ScrollArea,
  datePickerCalendarDate,
  datePickerDayBounds,
} from '@barghsa/ui';
import { useTimezone } from '../hooks/useTimezone.js';
import { useLocale } from '../hooks/useLocale.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
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
export default function CrmProfileList(props: { query?: ListQueryBinding } = {}) {
  const actor = useAccountUser();
  const contextRevision = useProfileContextRevision();
  return <OwnedCrmProfileList key={JSON.stringify([actor, contextRevision])} {...props} />;
}
function OwnedCrmProfileList({ query }: { query?: ListQueryBinding } = {}) {
  const client = useQueryClient();
  const reader = useId();
  const actor = useAccountUser();
  const contextRevision = useProfileContextRevision();
  const sequence = useRef(0);
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const preference = useTimezone();
  const search = useSearch({ from: '/admin/crm/' });
  const [localFilters, setLocalFilters] = useState({
    ...emptyFilters,
    verification: ['VERIFIED', 'UNVERIFIED', 'PENDING', 'DISABLED'].includes(
      search.verification ?? ''
    )
      ? search.verification!
      : '',
  });
  const [localText, setLocalText] = useState('');
  const [localTerm, setLocalTerm] = useState('');
  const filters = useMemo(
    () =>
      query
        ? {
            ...emptyFilters,
            type: query.query.filters.type ?? '',
            verification: query.query.filters.verification ?? '',
            dateFrom: query.query.filters.dateFrom ?? '',
            dateTo: query.query.filters.dateTo ?? '',
            staffOnly: query.query.filters.staffOnly === 'true',
            sort: query.query.sort,
            order: query.query.order,
          }
        : localFilters,
    [query?.query, localFilters]
  );
  const text = query?.searchInput ?? localText;
  const term = query?.query.search ?? localTerm;
  const queryRef = useRef(query);
  queryRef.current = query;
  const setFilters = setLocalFilters;
  const setText = useCallback((value: string) => {
    if (queryRef.current) queryRef.current.setSearchInput(value);
    else setLocalText(value);
  }, []);
  const setTerm = useCallback((value: string) => {
    if (queryRef.current) queryRef.current.setQuery({ search: value });
    else setLocalTerm(value);
  }, []);
  const [cursors, setCursors] = useState<string[]>(['']);
  const criteria = JSON.stringify([filters, term, preference.timezone]);
  const [accepted, setAccepted] = useState<{
    criteria: string;
    users: User[];
    cursor: string | null;
    hasMore: boolean;
  } | null>(null);
  const result = accepted?.criteria === criteria ? accepted : null;
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [revision, setRevision] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const generation = useRef(0);
  const sortFocus = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !result || !sortFocus.current) return;
    const sort = sortFocus.current;
    const frame = requestAnimationFrame(() => {
      if (sortFocus.current !== sort) return;
      const button = document.getElementById('crm-sort-' + sort);
      if (!button) return;
      sortFocus.current = null;
      const active = document.activeElement;
      if (active === document.body || active?.closest('[data-slot="scroll-area-viewport"]'))
        button.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, result]);
  useEffect(() => {
    if (query) return;
    if (text.trim() === term) return;
    const timer = setTimeout(() => {
      setTerm(text.trim());
      setCursors(['']);
    }, 300);
    return () => clearTimeout(timer);
  }, [text, term, query, setTerm]);
  const previousTimezone = useRef(preference.timezone);
  useEffect(() => {
    setCursors(['']);
    if (previousTimezone.current !== preference.timezone)
      queryRef.current?.setQuery({ cursor: '' }, true);
    previousTimezone.current = preference.timezone;
  }, [preference.timezone]);
  useEffect(() => setExpanded({}), [criteria]);
  const cursor = query?.query.cursor ?? cursors.at(-1) ?? '';
  const load = useCallback(async () => {
    const current = ++generation.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    if (denied || preference.status !== 'ready') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
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
    let cancel: (() => void) | undefined;
    try {
      const key = [
        ...queryKeys.profiles.list(
          {
            context: 'staff',
            ownerId: actor ?? 'current-account',
            accountId: actor,
            revision: contextRevision,
          },
          params,
          ++sequence.current
        ),
        reader,
        'crm-users',
        preference.timezone,
      ] as const;
      cancel = () => void client.cancelQueries({ queryKey: key, exact: true });
      controller.signal.addEventListener('abort', cancel, { once: true });
      const response = await client.fetchQuery({
        queryKey: key,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        queryFn: async ({ signal }) => {
          const response = await fetch(`/api/crm/users?${params}`, {
            credentials: 'include',
            signal,
          });
          return {
            status: response.status,
            ok: response.ok,
            value: response.ok ? await response.json() : null,
          };
        },
      });
      if (current !== generation.current || controller.signal.aborted) return;
      if ([401, 403].includes(response.status)) {
        ++generation.current;
        setDenied(true);
        setAccepted(null);
        setExpanded({});
        if (queryRef.current) queryRef.current.clear();
        else {
          setText('');
          setTerm('');
          setFilters(emptyFilters);
        }
        setCursors(['']);
        setLoading(false);
        return;
      }
      if (!response.ok) throw new Error('CRM unavailable');
      const data = response.value;
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
      if (current === generation.current && !controller.signal.aborted) {
        setAccepted({ ...data, criteria });
        setExpanded((previous) =>
          Object.fromEntries(
            Object.entries(previous).filter(([id]) =>
              data.users.some((user: User) => user.userId === id)
            )
          )
        );
      }
    } catch {
      if (current === generation.current && !controller.signal.aborted) setError(true);
    } finally {
      if (cancel) controller.signal.removeEventListener('abort', cancel);
      if (current === generation.current) setLoading(false);
    }
  }, [
    filters,
    term,
    cursor,
    criteria,
    denied,
    preference.status,
    preference.timezone,
    actor,
    contextRevision,
    client,
    reader,
  ]);
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
      controllerRef.current?.abort();
    };
  }, [load, revision]);
  function update(key: keyof typeof filters, value: string | boolean) {
    if (query) {
      if (key === 'order') query.setQuery({ order: value === 'asc' ? 'asc' : 'desc' });
      else if (key === 'sort') query.setQuery({ sort: String(value) });
      else
        query.setQuery({
          filters: { [key]: typeof value === 'boolean' ? (value ? 'true' : '') : value },
        });
    } else setFilters((previous) => ({ ...previous, [key]: value }));
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
          <Input
            id="crm-search"
            maxLength={256}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
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
            if (query) query.clear();
            else {
              setFilters(emptyFilters);
              setText('');
              setTerm('');
            }
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
            else {
              setDenied(false);
              setRevision((v) => v + 1);
            }
          }}
        >
          {t('crm.list.refresh', locale)}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {term && (
          <Button
            variant="outline"
            size="sm"
            className="h-auto max-w-full whitespace-normal text-start"
            onClick={() => {
              setText('');
              setTerm('');
              setCursors(['']);
              document.getElementById('crm-search')?.focus();
            }}
          >
            <span className="break-all">
              {t('crm.list.search', locale)}: <bdi>{term}</bdi> ×
            </span>
          </Button>
        )}
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
      {preference.status === 'error' && (
        <div role="alert">
          <p>{t('crm.list.timezoneError', locale)}</p>
          <Button onClick={preference.retry}>{t('crm.list.timezoneRetry', locale)}</Button>
        </div>
      )}
      {denied ? (
        <p role="alert">{t('crm.profile.error.accessDenied', locale)}</p>
      ) : (
        <ListPage>
          <ListPage.Content
            loading={loading || preference.status === 'loading'}
            error={error}
            empty={!result?.users.length}
            retainContent={!!result?.users.length}
            loadingView={<p role="status">{t('crm.list.loading', locale)}</p>}
            emptyView={preference.status === 'ready' ? <p>{t('crm.list.empty', locale)}</p> : null}
            errorView={
              <div role="alert">
                <p>{t('crm.list.error', locale)}</p>
                <Button onClick={() => void load()}>{t('crm.list.retry', locale)}</Button>
              </div>
            }
          >
            {!!result?.users.length && (
              <ScrollArea
                scrollbarOrientation="horizontal"
                className="max-w-full min-w-0 rounded-lg border bg-card text-card-foreground"
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
                                if (query)
                                  query.setQuery({
                                    sort: sort!,
                                    order:
                                      filters.sort === sort && filters.order === 'asc'
                                        ? 'desc'
                                        : 'asc',
                                  });
                                else
                                  setFilters((previous) => ({
                                    ...previous,
                                    sort: sort!,
                                    order:
                                      previous.sort === sort && previous.order === 'asc'
                                        ? 'desc'
                                        : 'asc',
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
                                {t('crm.list.profiles', locale)}:{' '}
                                {numbers.number(user.profileCount)}
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
                                        href={
                                          '/admin/crm/profiles/' + encodeURIComponent(profile.id)
                                        }
                                      >
                                        {profile.title ||
                                          t('crm.list.' + profile.profileType, locale)}{' '}
                                        · {t('crm.list.view', locale)}
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
              </ScrollArea>
            )}
          </ListPage.Content>
          <nav aria-label={t('crm.list.title', locale)} className="flex gap-2">
            <Button
              variant="outline"
              disabled={
                loading ||
                denied ||
                preference.status !== 'ready' ||
                (query ? !query.hasPrevious : cursors.length === 1)
              }
              onClick={() =>
                query ? query.previous() : setCursors((previous) => previous.slice(0, -1))
              }
            >
              {t('crm.list.previous', locale)}
            </Button>
            <Button
              variant="outline"
              disabled={
                loading ||
                error ||
                denied ||
                preference.status !== 'ready' ||
                !result?.hasMore ||
                !result.cursor ||
                (query ? !query.canAdvance(result.cursor) : false)
              }
              onClick={() => {
                if (result?.cursor) {
                  if (query) query.next(result.cursor);
                  else setCursors((previous) => [...previous, result.cursor!]);
                }
              }}
            >
              {t('crm.list.next', locale)}
            </Button>
          </nav>
        </ListPage>
      )}
    </section>
  );
}
