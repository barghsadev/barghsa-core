import { Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/app';
import { operationsAlertLinks } from '@barghsa/shared/notifications';
import { toNavigationTarget, type NotificationItem } from '../lib/notifications.js';

export function NotificationSubjectLinks({
  item,
  locale,
  operatingContext,
}: {
  item: NotificationItem;
  locale: Locale;
  operatingContext: 'customer' | 'staff';
}) {
  const subject = toNavigationTarget(item, operatingContext);
  const operations =
    operatingContext === 'staff' ? operationsAlertLinks(item.type, item.params) : [];
  if (!subject && !operations.length) return null;
  const classes = 'touch-action text-sm text-primary underline underline-offset-4';
  return (
    <div className="flex flex-wrap gap-x-4">
      {subject && (
        <Link to={subject.to} search={subject.search} className={classes}>
          {t('notifications.record.openSubject', locale)}
        </Link>
      )}
      {operations.map(({ label, href }) => (
        <a className={classes} href={href} key={label} target="_blank" rel="noreferrer">
          {t(label, locale)}
        </a>
      ))}
    </div>
  );
}
