import { notificationContent } from '../lib/notification-content.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { CheckCheckIcon, Loader2Icon, InboxIcon } from 'lucide-react';
import { Button, ListPage, ListRefreshButton, PageHeader } from '@barghsa/ui';
import { useNotificationAccessDenied } from '../hooks/useNotificationAccessDenied.js';
import { useLocale } from '../hooks/useLocale.js';
import {
  fetchNotifications,
  isNotificationDenied,
  notificationDisplayType,
  markOneRead,
  markAllRead,
  type NotificationFilter,
  type NotificationItem,
} from '../lib/notifications.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { NotificationRow } from '../components/NotificationRow.js';
import { NotificationSubjectLinks } from '../components/NotificationSubjectLinks.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useTimezone } from '../hooks/useTimezone.js';
import { notificationFeedback } from '@barghsa/i18n/notification-feedback';
import { notificationDateGroups } from '../lib/notification-date-groups.js';
import { sendToast } from '../lib/toast-api.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useManualServerRead } from '../hooks/useServerQuery.js';
import { useServerMutation } from '../hooks/useServerMutation.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
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
 * "unread only" filter and a "mark all read" action. Each message and its
 * subject have their own link, with read state managed inline. Shows a
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
  const authority = {
    context: operatingContext,
    accountId,
    ownerId: accountId ?? 'session',
    revision,
  };
  const inboxKey = queryKeys.notifications.all(authority);
  const readMark = useServerMutation<number, { version: number; id: string | null }>({
    mutationKey: inboxKey,
    write: ({ id }) => (id ? markOneRead(id) : markAllRead()),
    isCurrent: (command) =>
      !!command &&
      requestVersion.current === command.version &&
      liveKey.current === scope &&
      getProfileContextRevision() === revision,
    invalidate: [inboxKey],
    successMessage: () => undefined,
    errorMessage: () => undefined,
  });
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
        const queryKey = queryKeys.notifications.list(authority, params);
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
      const count = item?.isRead
        ? unreadCount
        : await readMark.mutateAsync({ id: item?.id ?? null, version });
      if (!current()) return;
      setUnreadCount(count);
      if (filter === 'unread' && count === 0) setNextCursor(null);
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
  const priority = items.filter(
    (item) =>
      !item.isRead &&
      (item.type === 'system.service_outage' || notificationDisplayType(item.type) === 'security')
  );
  const priorityIds = new Set(priority.map(({ id }) => id));
  const routine = items.filter(({ id }) => !priorityIds.has(id));
  const groups =
    zone.status === 'ready'
      ? notificationDateGroups(routine, zone.timezone, now, locale)
      : routine.length
        ? [{ key: 'ungrouped' as const, items: routine }]
        : [];
  const sections = [
    ...(priority.length
      ? [{ label: t('notifications.record.priority', locale), items: priority }]
      : []),
    ...groups.map((group) => ({
      label: notificationFeedback(group.key, locale),
      items: group.items,
    })),
  ];

  return (
    <section className="mx-auto min-w-0 max-w-3xl space-y-5" dir={isRtl ? 'rtl' : 'ltr'}>
      <PageHeader
        title={t('notifications.title', locale)}
        actions={
          <Button
            variant="outline"
            onClick={() => void markRead()}
            disabled={!ready || unreadCount === 0}
            className="gap-2"
          >
            {markingAll ? (
              <Loader2Icon className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <CheckCheckIcon className="size-4" aria-hidden="true" />
            )}
            {t('notifications.markAllRead', locale)}
          </Button>
        }
      />
      {zone.status === 'error' && (
        <p role="status">
          {notificationFeedback('datesUnavailable', locale)}{' '}
          <Button type="button" variant="outline" onClick={zone.retry}>
            {notificationFeedback('retry', locale)}
          </Button>
        </p>
      )}
      <ListPage>
        <ListPage.Toolbar
          className="items-center gap-x-2 border-b border-border/80"
          actions={
            <div
              role="tablist"
              aria-label={t('notifications.bellLabel', locale)}
              className="inline-flex gap-1 text-sm"
            >
              {(['all', 'unread'] as NotificationFilter[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  onClick={() => setFilter(value)}
                  disabled={markingAll}
                  className="min-h-11 shrink-0 border-b-2 border-transparent px-2.5 font-medium whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary aria-selected:border-primary aria-selected:text-primary sm:px-3.5"
                >
                  {t(value === 'all' ? 'notifications.bellLabel' : 'notifications.unread', locale)}
                </button>
              ))}
            </div>
          }
          refresh={
            <ListRefreshButton
              label={t('notifications.refresh', locale)}
              disabled={loading || loadingMore || markingAll}
              onClick={refresh}
            />
          }
        />
        <ListPage.Content
          loading={loading || loadingMore}
          error={!!error || denied}
          empty={items.length === 0}
          retainContent={acceptedKey === key && items.length > 0}
          loadingView={
            <RecordListSkeleton
              label={t('notifications.loading', locale)}
              view="card"
              headings={[]}
            />
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
              {sections.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <h2 className="mb-2 text-sm font-semibold">{group.label}</h2>
                  <ul className="divide-y divide-border rounded-lg border bg-card text-card-foreground">
                    {group.items.map((item) => (
                      <li key={item.id} className="min-w-0">
                        <Link
                          to={
                            operatingContext === 'staff'
                              ? '/admin/inbox/$notificationId'
                              : '/notifications/$notificationId'
                          }
                          params={{ notificationId: item.id }}
                          search={{ filter: filter === 'unread' ? filter : undefined, cursor }}
                          className="block min-w-0 px-4 py-3 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                          aria-label={notificationContent(item, locale).title}
                        >
                          <NotificationRow
                            item={item}
                            locale={locale}
                            unread={!item.isRead}
                            muted={item.isRead}
                            inbox
                            operatingContext={operatingContext}
                          />
                        </Link>
                        {ready && (
                          <div className="flex flex-wrap items-center gap-x-4 border-t px-4 empty:hidden">
                            <NotificationSubjectLinks
                              item={item}
                              locale={locale}
                              operatingContext={operatingContext}
                            />
                            {!item.isRead && (
                              <button
                                type="button"
                                onClick={() => void markRead(item)}
                                className="touch-action rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                                aria-label={`${t('notifications.markReadAria', locale)} — ${notificationContent(item, locale).title}`}
                              >
                                {t('notifications.record.markRead', locale)}
                              </button>
                            )}
                          </div>
                        )}
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
