import {
  createFileRoute,
  lazyRouteComponent,
  notFound,
  redirect,
  useLocation,
} from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { staffOrderId } from '../../lib/staff-order-list-query.js';
import { solarDocumentsSearch } from '../../lib/solar-staff-query.js';

const Request = lazyRouteComponent(
  () => import('../../pages/AdminSolarDocumentsPage.js'),
  'AdminSolarDocumentsPage'
);

function SolarRequestRoute() {
  const { requestId, operation, documentId } = Route.useParams();
  const search = Route.useSearch();
  const hash = useLocation({ select: (location) => location.hash });
  if (requestId === 'guidance') {
    if (operation || documentId) throw notFound();
    return <Request key="guidance" queueSearch={search} guidanceEditor />;
  }
  const fileDecision = operation === 'approve' || operation === 'reject';
  const requestDecision = operation === 'request-additional' || operation === 'advance-postal';
  if (fileDecision ? !staffOrderId(documentId) : documentId || (operation && !requestDecision))
    throw notFound();
  const editor =
    fileDecision && documentId
      ? { operation, documentId }
      : requestDecision
        ? { operation }
        : undefined;
  const selectedFile = hash.startsWith('solar-document-')
    ? staffOrderId(hash.slice('solar-document-'.length)).toLowerCase()
    : '';
  return (
    <Request
      key={JSON.stringify([requestId, operation, documentId])}
      recordId={requestId}
      queueSearch={search}
      selectedFile={selectedFile}
      editor={editor}
    />
  );
}

export const Route = createFileRoute(
  '/admin/solar-requests/$requestId/{-$operation}/{-$documentId}'
)({
  validateSearch: solarDocumentsSearch,
  beforeLoad: ({ params, search, location }) => {
    if (params.requestId === 'guidance') return;
    const requestId = staffOrderId(params.requestId).toLowerCase();
    if (!requestId) throw notFound();
    const documentId = staffOrderId(params.documentId).toLowerCase() || params.documentId;
    if (params.requestId !== requestId || params.documentId !== documentId)
      throw redirect({
        to: '/admin/solar-requests/$requestId/{-$operation}/{-$documentId}',
        params: { ...params, requestId, documentId },
        search,
        hash: location.hash,
        replace: true,
      });
  },
  component: SolarRequestRoute,
  pendingComponent: StaffRecordLoading,
});
