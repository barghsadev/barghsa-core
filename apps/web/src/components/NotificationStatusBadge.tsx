import { t, type Locale } from '@barghsa/i18n/workspace';
import {
  CreditCardIcon,
  FileTextIcon,
  InfoIcon,
  PackageIcon,
  ShieldAlertIcon,
  type LucideIcon,
} from 'lucide-react';
import { notificationDisplayType } from '../lib/notifications.js';

const CATEGORY_STYLE: Record<
  ReturnType<typeof notificationDisplayType>,
  { icon: LucideIcon; className: string }
> = {
  security: { icon: ShieldAlertIcon, className: 'bg-danger-soft text-destructive' },
  payment: { icon: CreditCardIcon, className: 'bg-success-soft text-success' },
  contract: { icon: FileTextIcon, className: 'bg-info-soft text-info' },
  order: { icon: PackageIcon, className: 'bg-primary/10 text-primary' },
  document: { icon: FileTextIcon, className: 'bg-warning-soft text-warning' },
  system: { icon: InfoIcon, className: 'bg-muted text-muted-foreground' },
};

/** The same labeled category marker in the notification bell and full inbox. */
export function NotificationStatusBadge({ type, locale }: { type: string; locale: Locale }) {
  const category = notificationDisplayType(type);
  const { icon: Icon, className } = CATEGORY_STYLE[category];
  const label = t(`notifications.type.${category}`, locale);

  return (
    <span
      data-slot="notification-status-badge"
      title={label}
      className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs ${className}`}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
