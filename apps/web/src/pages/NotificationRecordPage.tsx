import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button, LoadingStatus } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useNotificationAccessDenied } from '../hooks/useNotificationAccessDenied.js';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { useServerMutation } from '../hooks/useServerMutation.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { notificationContent } from '../lib/notification-content.js';
import {
  fetchNotification,
  isNotificationDenied,
  markOneRead,
  NotificationApiError,
} from '../lib/notifications.js';
import { NotificationStatusBadge } from '../components/NotificationStatusBadge.js';
import { NotificationSubjectLinks } from '../components/NotificationSubjectLinks.js';

type RecordProps = {
  id: string;
  operatingContext: 'customer' | 'staff';
  historySearch: Record<string, unknown>;
};

export default function NotificationRecordPage(props: RecordProps) {
  const accountId = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <NotificationRecord
      key={JSON.stringify([accountId, revision, props.id, props.operatingContext])}
      accountId={accountId}
      revision={revision}
      {...props}
    />
  );
}

function NotificationRecord({
  id,
  operatingContext,
  historySearch,
  accountId,
  revision,
}: RecordProps & { accountId: string | null; revision: number }) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const [denied, setDenied] = useState(false);
  const deny = useNotificationAccessDenied(operatingContext, () => setDenied(true));
  const scope = { context: operatingContext, accountId, ownerId: accountId ?? 'session', revision };
  const key = queryKeys.notifications.detail(scope, id);
  const read = useServerDetailQuery({
    queryKey: denied ? null : key,
    read: (signal) => fetchNotification(id, signal),
    manual: true,
  });
  const markRead = useServerMutation<number, string>({
    mutationKey: denied ? null : key,
    write: markOneRead,
    isCurrent: (current) => current === id && getProfileContextRevision() === revision,
    invalidate: [queryKeys.notifications.all(scope)],
    successMessage: () => undefined,
    errorMessage: () => undefined,
  });
  useEffect(() => {
    if (isNotificationDenied(read.error) || isNotificationDenied(markRead.error)) deny();
  }, [read.error, markRead.error, deny]);
  const isDenied =
    denied || isNotificationDenied(read.error) || isNotificationDenied(markRead.error);
  const item = isDenied || read.isError ? undefined : read.data;
  const content = item && notificationContent(item, locale);
  const missing =
    read.error instanceof NotificationApiError && [400, 404].includes(read.error.status);
  const word = (name: string) => t(`notifications.record.${name}`, locale);

  return (
    <article className="mx-auto max-w-3xl min-w-0 space-y-5">
      <Link
        to={operatingContext === 'staff' ? '/admin/inbox' : '/notifications'}
        search={historySearch}
        className="touch-action text-sm font-medium text-primary underline underline-offset-4"
      >
        {t('notifications.title', locale)}
      </Link>
      <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]">
        {content?.title ?? word('title')}
      </h1>
      {isDenied || missing ? (
        <p role="alert">{word('unavailable')}</p>
      ) : read.isError ? (
        <div className="space-y-2" role="alert">
          <p>{t('notifications.error.load', locale)}</p>
          <Button variant="outline" onClick={() => void read.refetch()}>
            {t('notifications.retry', locale)}
          </Button>
        </div>
      ) : item && content ? (
        <div className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          {time.notice}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <NotificationStatusBadge type={item.type} locale={locale} />
            <time dateTime={item.createdAt} className="text-muted-foreground">
              {time.format(item.createdAt)}
            </time>
            <span>{item.isRead ? word('read') : t('notifications.unread', locale)}</span>
          </div>
          <p className="whitespace-pre-line [overflow-wrap:anywhere]">{content.body}</p>
          <NotificationSubjectLinks
            item={item}
            locale={locale}
            operatingContext={operatingContext}
          />
          {!item.isRead && (
            <Button
              variant="outline"
              disabled={markRead.isPending}
              onClick={() => void markRead.mutateAsync(item.id).catch(() => {})}
            >
              {t('notifications.markReadAria', locale)}
            </Button>
          )}
          {markRead.error && <p role="alert">{t('notifications.error.write', locale)}</p>}
        </div>
      ) : (
        <LoadingStatus>{t('notifications.loading', locale)}</LoadingStatus>
      )}
    </article>
  );
}
