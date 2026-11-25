import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { notificationInboxSearch } from '../../lib/notification-inbox-query.js';

const Page = lazyRouteComponent(() => import('../../pages/NotificationRecordPage.js'));

export const Route = createFileRoute('/admin/inbox_/$notificationId')({
  validateSearch: notificationInboxSearch,
  component: RecordRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function RecordRoute() {
  return (
    <Page
      id={Route.useParams().notificationId}
      operatingContext="staff"
      historySearch={Route.useSearch()}
    />
  );
}
