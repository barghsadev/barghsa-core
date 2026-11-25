import AdminAiSections from '../../components/AdminAiSections.js';
import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { isCatalogueRecordId } from '../../lib/catalogue-workspace.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminKnowledgeBasesPage.js'));

function CatalogueRecordRoute() {
  const { recordId, action } = Route.useParams();
  const navigate = Route.useNavigate();
  if (
    !isCatalogueRecordId(recordId) ||
    (action &&
      (recordId === 'new' ||
        (action !== 'edit' && action !== 'documents' && action !== 'ingestion')))
  )
    throw notFound();
  const showRecord = (id: string, replace = false) =>
    void navigate({
      to: '/admin/knowledge-bases/$recordId/{-$action}',
      params: { recordId: id, action: undefined },
      replace,
    });
  const showList = (replace = false) =>
    void navigate({ to: '/admin/knowledge-bases', search: {}, replace });
  return (
    <AdminAiSections section="/admin/knowledge-bases">
      <Page
        key={`${recordId}/${action ?? ''}`}
        initialKind="knowledge-bases"
        workspace={
          recordId === 'new'
            ? { view: 'create', showRecord, showList }
            : { view: action ?? 'detail', recordId, showRecord, showList }
        }
      />
    </AdminAiSections>
  );
}

export const Route = createFileRoute('/admin/knowledge-bases_/$recordId/{-$action}')({
  component: CatalogueRecordRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
