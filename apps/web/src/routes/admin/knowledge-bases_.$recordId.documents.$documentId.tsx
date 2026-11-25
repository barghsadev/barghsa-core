import AdminAiSections from '../../components/AdminAiSections.js';
import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { isCatalogueRecordId } from '../../lib/catalogue-workspace.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminKnowledgeBasesPage.js'));

function KnowledgeDocumentRoute() {
  const { recordId, documentId } = Route.useParams();
  const navigate = Route.useNavigate();
  if (!isCatalogueRecordId(recordId) || !isCatalogueRecordId(documentId) || recordId === 'new')
    throw notFound();
  return (
    <AdminAiSections section="/admin/knowledge-bases">
      <Page
        key={`${recordId}/${documentId}`}
        workspace={{
          view: 'document',
          recordId,
          documentId,
          showRecord: (id, replace = false) =>
            void navigate({
              to: '/admin/knowledge-bases/$recordId/{-$action}',
              params: { recordId: id, action: undefined },
              replace,
            }),
          showList: (replace = false) => void navigate({ to: '/admin/knowledge-bases', replace }),
        }}
      />
    </AdminAiSections>
  );
}

export const Route = createFileRoute('/admin/knowledge-bases_/$recordId/documents/$documentId')({
  component: KnowledgeDocumentRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
