import { NotificationCenterPage } from './NotificationCenterPage.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';

export default function StaffNotificationCenterPage({
  queries,
}: { queries?: ListQueryBinding } = {}) {
  return <NotificationCenterPage operatingContext="staff" {...(queries ? { queries } : {})} />;
}
