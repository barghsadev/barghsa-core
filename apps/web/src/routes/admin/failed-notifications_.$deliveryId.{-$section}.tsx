import { createFileRoute, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';
import { failedNotificationPageSearch } from '../../lib/notification-panel-query.js';
import { deliveryHistoryQueryOptions } from '../../lib/operations-list-query.js';

import Page from '../../pages/AdminFailedNotificationsPage.js';

export const Route = createFileRoute('/admin/failed-notifications_/$deliveryId/{-$section}')({
  validateSearch: failedNotificationPageSearch,
  component: DeliveryRecordRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
});

function DeliveryRecordRoute() {
  const { deliveryId, section } = Route.useParams();
  const recordId = adminEditorId(deliveryId);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(deliveryHistoryQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => failedNotificationPageSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  if (!recordId || (section !== undefined && section !== 'history')) throw notFound();
  const recordHistory = section === 'history';
  return (
    <Page
      key={recordId}
      recordId={recordId}
      recordHistory={recordHistory}
      historySearch={search}
      historyQueries={recordHistory ? queries : undefined}
    />
  );
}
