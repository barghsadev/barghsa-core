import { createFileRoute } from '@tanstack/react-router';
import { NotificationCenterPage } from '../../pages/NotificationCenterPage.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  notificationInboxQueryOptions,
  notificationInboxSearch,
} from '../../lib/notification-inbox-query.js';

function InboxRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(notificationInboxQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => notificationInboxSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <NotificationCenterPage queries={queries} />;
}

export const Route = createFileRoute('/_app/notifications')({
  validateSearch: notificationInboxSearch,
  component: InboxRoute,
});
