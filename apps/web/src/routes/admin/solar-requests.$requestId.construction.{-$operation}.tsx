import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { RouteNotFound } from '../../components/RouteErrorBoundary.js';
import { solarConstructionQueueSearch } from '../../lib/solar-construction-query.js';
import { solarMilestoneFromPath } from '../../lib/solar-progress.js';
import { staffOrderId } from '../../lib/staff-order-list-query.js';

const Page = lazyRouteComponent(
  () => import('../../pages/AdminSolarConstructionPage.js'),
  'AdminSolarConstructionPage'
);

function ConstructionRecord() {
  const { requestId, operation } = Route.useParams();
  const search = Route.useSearch();
  const milestoneEditor = solarMilestoneFromPath(operation);
  if (operation && !milestoneEditor) return <RouteNotFound />;
  return (
    <Page
      key={JSON.stringify([requestId, operation])}
      selected={requestId}
      queueSearch={search}
      {...(milestoneEditor && { milestoneEditor })}
    />
  );
}

export const Route = createFileRoute('/admin/solar-requests/$requestId/construction/{-$operation}')(
  {
    validateSearch: solarConstructionQueueSearch,
    beforeLoad: ({ params, search }) => {
      const requestId = staffOrderId(params.requestId).toLowerCase();
      if (!requestId) throw notFound();
      if (params.requestId !== requestId)
        throw redirect({
          to: '/admin/solar-requests/$requestId/construction/{-$operation}',
          params: { ...params, requestId },
          search,
          replace: true,
        });
    },
    component: ConstructionRecord,
    pendingComponent: StaffRecordLoading,
  }
);
