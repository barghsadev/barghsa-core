import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { failedJobsSearch } from '../../lib/operations-list-query.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminFailedJobsPage.js'));
export const Route = createFileRoute('/admin/failed-jobs_/$jobId')({
  validateSearch: failedJobsSearch,
  component: FailedJobRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function FailedJobRoute() {
  const recordId = adminEditorId(Route.useParams().jobId);
  const search = Route.useSearch();
  if (!recordId) throw notFound();
  return <Page key={recordId} recordId={recordId} historySearch={search} />;
}
