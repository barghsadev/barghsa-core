import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { documentActions } from '../../lib/documents.js';
import { staffDocumentFilters } from '../../lib/record-list-query.js';
import { staffOrderId } from '../../lib/staff-order-list-query.js';

const Page = lazyRouteComponent(() => import('../../pages/DocumentRecordPage.js'));
const Governance = lazyRouteComponent(() => import('../../pages/DocumentGovernancePage.js'));

function DocumentRoute() {
  const { documentId, section, action, holdId } = Route.useParams();
  const search = Route.useSearch();
  if (documentId === 'governance') {
    if (holdId) throw notFound();
    return <Governance operation={section} recordId={action} search={search} />;
  }
  if (documentId === 'new') {
    if (section || action || holdId) throw notFound();
    return <Page staff entry={{ mode: 'upload' }} search={search} />;
  }
  if (section === 'decisions' && !holdId) {
    const decision = documentActions.find((item) => item === action);
    if (!decision) throw notFound();
    return <Page staff entry={{ mode: 'decision', documentId, decision }} search={search} />;
  }
  const validHolds =
    section === 'holds' &&
    (action === 'release' ? !!staffOrderId(holdId) : !holdId && (!action || action === 'new'));
  const validRecord = (!section || section === 'replace') && !action && !holdId;
  if (!validRecord && !validHolds) throw notFound();
  const page = holdId ? { releaseId: holdId.toLowerCase() } : action === 'new' ? 'new' : 'history';
  const entry =
    section === 'holds'
      ? ({ mode: 'holds', documentId, page } as const)
      : ({ mode: section === 'replace' ? 'replace' : 'record', documentId } as const);
  return <Page staff entry={entry} search={search} />;
}

export const Route = createFileRoute(
  '/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}'
)({
  validateSearch: staffDocumentFilters,
  beforeLoad: ({ params, search }) => {
    if (params.documentId === 'governance' || params.documentId === 'new') return;
    const documentId = staffOrderId(params.documentId).toLowerCase();
    if (!documentId) throw notFound();
    if (documentId !== params.documentId)
      throw redirect({
        to: '/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}',
        params: { ...params, documentId },
        search,
        replace: true,
      });
  },
  component: DocumentRoute,
  pendingComponent: StaffRecordLoading,
});
