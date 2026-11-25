import { createFileRoute, redirect } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  failedNotificationQueryOptions,
  failedNotificationPageSearch,
  deliveryHistoryWorkspaceSearch,
} from '../../lib/notification-panel-query.js';
import { deliveryHistoryQueryOptions } from '../../lib/operations-list-query.js';
import Page from '../../pages/AdminFailedNotificationsPage.js';

function FailedNotificationsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(failedNotificationQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => failedNotificationPageSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  const historyQueries = useListQuery(deliveryHistoryQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => failedNotificationPageSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page queries={queries} historyQueries={historyQueries} historySearch={search} />;
}
export const Route = createFileRoute('/admin/failed-notifications')({
  validateSearch: failedNotificationPageSearch,
  beforeLoad: ({ search }) => {
    if (search.history_mode === 'all')
      throw redirect({
        to: '/admin/failed-notifications/history',
        search: deliveryHistoryWorkspaceSearch(search),
        replace: true,
      });
  },
  component: FailedNotificationsRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
});
