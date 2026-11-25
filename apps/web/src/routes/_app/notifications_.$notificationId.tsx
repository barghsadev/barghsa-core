import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { notificationInboxSearch } from '../../lib/notification-inbox-query.js';

const Page = lazyRouteComponent(() => import('../../pages/NotificationRecordPage.js'));

export const Route = createFileRoute('/_app/notifications_/$notificationId')({
  validateSearch: notificationInboxSearch,
  component: RecordRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});

function RecordRoute() {
  return (
    <Page
      id={Route.useParams().notificationId}
      operatingContext="customer"
      historySearch={Route.useSearch()}
    />
  );
}
