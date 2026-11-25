import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { solarPostalSearch } from '../../lib/solar-staff-query.js';
import { staffOrderId } from '../../lib/staff-order-list-query.js';
import {
  solarPostalDecisions,
  type SolarPostalOperation,
} from '../../lib/solar-postal-decisions.js';

const Page = lazyRouteComponent(
  () => import('../../pages/AdminSolarPostalPage.js'),
  'AdminSolarPostalPage'
);

function PostalRecord() {
  const { requestId, operation } = Route.useParams();
  const search = Route.useSearch();
  const recordEditor =
    operation === 'create-contract' || operation === 'tracking' ? operation : undefined;
  if (
    operation &&
    (requestId === 'guidance' || (!recordEditor && !Object.hasOwn(solarPostalDecisions, operation)))
  )
    throw notFound();
  return requestId === 'guidance' ? (
    <Page key={requestId} queueSearch={search} guidanceEditor />
  ) : (
    <Page
      key={JSON.stringify([requestId, operation])}
      recordId={requestId}
      queueSearch={search}
      recordEditor={recordEditor}
      decisionEditor={recordEditor ? undefined : (operation as SolarPostalOperation | undefined)}
    />
  );
}

export const Route = createFileRoute('/admin/solar-requests/$requestId/postal/{-$operation}')({
  validateSearch: solarPostalSearch,
  beforeLoad: ({ params, search }) => {
    if (params.requestId === 'guidance') return;
    const requestId = staffOrderId(params.requestId).toLowerCase();
    if (!requestId) throw notFound();
    if (requestId !== params.requestId)
      throw redirect({
        to: '/admin/solar-requests/$requestId/postal/{-$operation}',
        params: { ...params, requestId },
        search,
        replace: true,
      });
  },
  component: PostalRecord,
  pendingComponent: StaffRecordLoading,
});
