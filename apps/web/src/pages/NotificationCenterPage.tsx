import { notificationContent } from '../lib/notifications.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, type NavigateOptions } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { BellIcon, CheckCheckIcon, Loader2Icon, InboxIcon } from 'lucide-react';
import { Button, ListPage, LoadingSkeleton } from '@barghsa/ui';
import { useNotificationAccessDenied } from '../hooks/useNotificationAccessDenied.js';
import { useLocale } from '../hooks/useLocale.js';
import {
  fetchNotifications,
  isNotificationDenied,
  markOneRead,
  markAllRead,
  toNavigationTarget,
  type NotificationFilter,
  type NotificationItem,
} from '../lib/notifications.js';
import { NotificationRow } from '../components/NotificationRow.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useTimezone } from '../hooks/useTimezone.js';
import { notificationFeedback } from '@barghsa/i18n/notification-feedback';
import { notificationDateGroups } from '../lib/notification-date-groups.js';
import { sendToast } from '../lib/toast-api.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useManualServerRead } from '../hooks/useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';

const PAGE_SIZE = 20;
type InboxProps = { operatingContext?: 'staff' | 'customer'; queries?: ListQueryBinding };

export function NotificationCenterPage(props: InboxProps) {
  const accountId = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedInbox key={JSON.stringify([props.operatingContext, accountId, revision])} {...props} />
  );
}

/**
 * Notification center page (E-05, T-05.02.03).
 *
 * Full, cursor-paginated list of the active profile's notifications with an
 * "unread only" filter and a "mark all read" action. Each item marks itself
 * read on click and navigates to its linked record when one is set. Shows a
 * loading skeleton, an empty state, and a load-more footer. RTL-aware.
 */
function OwnedInbox({ operatingContext = 'customer', queries }: InboxProps) {
  const locale = useLocale();
  const accountId = useAccountUser();
  const revision = useProfileContextRevision();
  const readPage = useManualServerRead();
  const zone = useTimezone();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const navigate = useNavigate();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [localFilter, setLocalFilter] = useState<NotificationFilter>('all');
  const filter = queries ? (queries.query.filters.filter as NotificationFilter) : localFilter;
  const cursor = queries?.query.cursor || undefined;
  const setFilter = (value: NotificationFilter) =>
    queries ? queries.setQuery({ filters: { filter: value } }) : setLocalFilter(value);
  const [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<'read' | 'write' | null>(null),
    [denied, setDenied] = useState(false);
  const [acceptedKey, setAcceptedKey] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const writing = useRef(false),
    requestVersion = useRef(0);
  const failedCursor = useRef<string | undefined>(undefined),
    cursors = useRef(new Set<string>());
  const readController = useRef<AbortController | null>(null);
  const key = `${operatingContext}:${filter}`;
  const scope = JSON.stringify([key, cursor]);
  const liveKey = useRef(scope);
  liveKey.current = scope;
  const acceptedScope = useRef<string | null>(null);
  const intendedNavigation = useRef<{ scope: string; append: boolean } | null>(null);
  const failedAppend = useRef(false);
  const clearDenied = useCallback(() => {
    requestVersion.current++;
    readController.current?.abort();
    writing.current = false;
    setItems([]);
    setNextCursor(null);
    setUnreadCount(0);
    setAcceptedKey(null);
    acceptedScope.current = null;
    setDenied(true);
    setError('read');
    setLoading(false);
    setLoadingMore(false);
    setMarkingAll(false);
    failedCursor.current = undefined;
    cursors.current.clear();
  }, []);
  const deny = useNotificationAccessDenied(operatingContext, clearDenied);
  const load = useCallback(
    async (cursor?: string, append = !!cursor) => {
      if (writing.current) return;
      const version = ++requestVersion.current;
      readController.current?.abort();
      const controller = new AbortController();
      readController.current = controller;
      setLoading(!cursor);
      setLoadingMore(!!cursor);
      const current = () => requestVersion.current === version && liveKey.current === scope;
      try {
        const params = new URLSearchParams({ filter, limit: String(PAGE_SIZE) });
        if (cursor) params.set('cursor', cursor);
        const queryKey = queryKeys.notifications.list(
          { context: operatingContext, accountId, ownerId: accountId ?? 'session', revision },
          params
        );
        const page = await readPage(queryKey, controller.signal, (signal) =>
          fetchNotifications(cursor, filter, PAGE_SIZE, signal)
        );
        if (!current()) return;
        if (
          page.next_cursor &&
          (page.next_cursor === cursor || (cursor && cursors.current.has(page.next_cursor)))
        )
          throw new Error('Repeated notification cursor');
        if (!append) cursors.current.clear();
        if (cursor) cursors.current.add(cursor);
        setItems((prev) =>
          append
            ? [...new Map([...prev, ...page.data].map((item) => [item.id, item])).values()]
            : page.data
        );
        setNextCursor(page.next_cursor);
        setUnreadCount(page.unread_count);
        setAcceptedKey(key);
        acceptedScope.current = scope;
        setDenied(false);
        setError(null);
      } catch (failure) {
        if (!current()) return;
        if (isNotificationDenied(failure)) deny();
        else {
          failedCursor.current = cursor;
          failedAppend.current = append;
          setError('read');
        }
      } finally {
        if (readController.current === controller) readController.current = null;
        if (current()) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [filter, key, scope, deny, readPage, accountId, revision, operatingContext]
  );
  useEffect(() => {
    const intended = intendedNavigation.current;
    const retaining = intended?.scope === scope;
    intendedNavigation.current = null;
    if (!retaining) {
      setItems([]);
      setNextCursor(null);
      setUnreadCount(0);
      setAcceptedKey(null);
      acceptedScope.current = null;
      cursors.current.clear();
    }
    setDenied(false);
    setError(null);
    setMarkingAll(false);
    failedCursor.current = undefined;
    void load(cursor, retaining ? intended.append : false);
    return () => {
      requestVersion.current++;
      readController.current?.abort();
      writing.current = false;
    };
  }, [load]);
  function refresh() {
    if (queries && cursor) {
      intendedNavigation.current = { scope: JSON.stringify([key, undefined]), append: false };
      queries.setQuery({ cursor: '' });
    } else void load();
  }
  const ready =
    acceptedKey === key &&
    acceptedScope.current === scope &&
    !denied &&
    !loading &&
    !loadingMore &&
    !error &&
    !markingAll;
  const markRead = async (item?: NotificationItem) => {
    if (!ready || writing.current) return;
    const target = item ? toNavigationTarget(item, operatingContext) : null;
    const version = ++requestVersion.current;
    const current = () => requestVersion.current === version && liveKey.current === scope;
    const previousItems = items,
      previousCount = unreadCount;
    writing.current = true;
    setMarkingAll(true);
    setError(null);
    setUnreadCount(item ? Math.max(0, unreadCount - Number(!item.isRead)) : 0);
    setItems((prev) =>
      prev.flatMap((row) =>
        !item || row.id === item.id
          ? filter === 'unread'
            ? []
            : [{ ...row, isRead: true }]
          : [row]
      )
    );
    try {
      const count = item
        ? item.isRead
          ? unreadCount
          : await markOneRead(item.id)
        : await markAllRead();
      if (!current()) return;
      setUnreadCount(count);
      if (filter === 'unread' && count === 0) setNextCursor(null);
      if (target)
        navigate({
          to: target.to,
          search: target.search as NavigateOptions['search'],
        } as NavigateOptions);
    } catch (failure) {
      if (!current()) return;
      if (isNotificationDenied(failure)) deny();
      else {
        setItems(previousItems);
        setUnreadCount(previousCount);
        setError('write');
        sendToast('warning', t('notifications.error.write', locale));
      }
    } finally {
      if (current()) {
        writing.current = false;
        setMarkingAll(false);
      }
    }
  };

  const isRtl = locale === 'fa';
  const groups =
    zone.status === 'ready'
      ? notificationDateGroups(items, zone.timezone, now, locale)
      : [{ key: 'ungrouped' as const, items }];

  return (
    <section className="mx-auto min-w-0 max-w-3xl space-y-5" dir={isRtl ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BellIcon className="h-6 w-6" aria-hidden="true" />
          <h1 className="text-2xl font-bold">{t('notifications.title', locale)}</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void markRead()}
          disabled={!ready || unreadCount === 0}
          className="gap-2"
        >
          {markingAll ? (
            <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCheckIcon className="h-4 w-4" aria-hidden="true" />
          )}
          {t('notifications.markAllRead', locale)}
        </Button>
      </header>
      {zone.status === 'error' && (
        <p role="status">
          {notificationFeedback('datesUnavailable', locale)}{' '}
          <Button type="button" variant="outline" onClick={zone.retry}>
            {notificationFeedback('retry', locale)}
          </Button>
        </p>
      )}
      <ListPage>
        <ListPage.Toolbar>
          <Button
            type="button"
            variant="outline"
            disabled={loading || loadingMore || markingAll}
            onClick={refresh}
          >
            {t('notifications.refresh', locale)}
          </Button>
          <div
            role="tablist"
            aria-label={t('notifications.bellLabel', locale)}
            className="flex gap-1 rounded-lg bg-muted p-1 text-sm"
          >
            {(['all', 'unread'] as NotificationFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                disabled={markingAll}
                className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${filter === value ? 'bg-card text-card-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {t(value === 'all' ? 'notifications.bellLabel' : 'notifications.unread', locale)}
              </button>
            ))}
          </div>
        </ListPage.Toolbar>
        <ListPage.Content
          loading={loading || loadingMore}
          error={!!error || denied}
          empty={items.length === 0}
          retainContent={acceptedKey === key && items.length > 0}
          loadingView={
            <LoadingSkeleton label={t('notifications.loading', locale)} variant="table" />
          }
          errorView={
            <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-4">
              <p>
                {t(
                  denied
                    ? 'notifications.error.denied'
                    : error === 'write'
                      ? 'notifications.error.write'
                      : 'notifications.error.load',
                  locale
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={loading || loadingMore || markingAll}
                onClick={() =>
                  denied
                    ? refresh()
                    : void load(
                        error === 'read' ? failedCursor.current : cursor,
                        error === 'read' ? failedAppend.current : false
                      )
                }
              >
                {t('notifications.retry', locale)}
              </Button>
            </div>
          }
          emptyView={
            <div className="rounded-lg border bg-card p-10 text-center">
              <InboxIcon className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-semibold">
                {t(
                  filter === 'unread' ? 'notifications.empty.unread' : 'notifications.empty.title',
                  locale
                )}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('notifications.empty.body', locale)}
              </p>
            </div>
          }
        >
          {acceptedKey === key && items.length > 0 && (
            <div className="space-y-5">
              {groups.map((group) => (
                <section key={group.key} aria-label={notificationFeedback(group.key, locale)}>
                  <h2 className="mb-2 text-sm font-semibold">
                    {notificationFeedback(group.key, locale)}
                  </h2>
                  <ul className="divide-y divide-border rounded-lg border bg-card text-card-foreground">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => void markRead(item)}
                          disabled={!ready}
                          className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                          aria-label={`${t('notifications.markReadAria', locale)} — ${notificationContent(item, locale).title}`}
                        >
                          <span className="min-w-0 flex-1">
                            <NotificationRow
                              item={item}
                              locale={locale}
                              unread={!item.isRead}
                              muted={item.isRead}
                              operatingContext={operatingContext}
                            />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </ListPage.Content>
        <ListPage.Pagination
          kind="cursor"
          hasMore={
            acceptedKey === key &&
            !!nextCursor &&
            !error &&
            !denied &&
            (loading || loadingMore || !queries || queries.canAdvance(nextCursor))
          }
          loading={loading || loadingMore || markingAll}
          onNext={() => {
            if (ready && nextCursor) {
              if (queries) {
                intendedNavigation.current = {
                  scope: JSON.stringify([key, nextCursor]),
                  append: true,
                };
                queries.next(nextCursor);
              } else void load(nextCursor);
            }
          }}
          label={t('historyPagination.label', locale)}
          nextLabel={t('notifications.loadMore', locale)}
        />
      </ListPage>
    </section>
  );
}
