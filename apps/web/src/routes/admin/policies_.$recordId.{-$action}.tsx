import AdminAiSections from '../../components/AdminAiSections.js';
import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { isCatalogueRecordId } from '../../lib/catalogue-workspace.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminAiPoliciesPage.js'));

function CatalogueRecordRoute() {
  const { recordId, action } = Route.useParams();
  const navigate = Route.useNavigate();
  if (!isCatalogueRecordId(recordId) || (action && (recordId === 'new' || action !== 'edit')))
    throw notFound();
  const showRecord = (id: string, replace = false) =>
    void navigate({
      to: '/admin/policies/$recordId/{-$action}',
      params: { recordId: id, action: undefined },
      replace,
    });
  const showList = (replace = false) =>
    void navigate({ to: '/admin/policies', search: {}, replace });
  return (
    <AdminAiSections section="/admin/policies">
      <Page
        key={`${recordId}/${action ?? ''}`}
        initialKind="policies"
        workspace={
          recordId === 'new'
            ? { view: 'create', showRecord, showList }
            : { view: action ?? 'detail', recordId, showRecord, showList }
        }
      />
    </AdminAiSections>
  );
}

export const Route = createFileRoute('/admin/policies_/$recordId/{-$action}')({
  component: CatalogueRecordRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
