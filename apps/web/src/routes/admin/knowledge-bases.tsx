import AdminAiSections from '../../components/AdminAiSections.js';
import { useRef } from 'react';
import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { knowledgeCatalogueSearch } from '../../lib/catalogue-category-query.js';
import { catalogueWorkspaceSearch } from '../../lib/catalogue-workspace.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminKnowledgeBasesPage.js'));
function CatalogueRoute() {
  const focusCategory = useRef(false);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const kind = search.kind === 'kb-groups' ? 'kb-groups' : 'knowledge-bases';
  return (
    <AdminAiSections section="/admin/knowledge-bases">
      <Page
        key={kind}
        initialKind={kind}
        focusCategory={focusCategory.current}
        workspace={{ view: 'list' }}
        onKindChange={(value) => {
          focusCategory.current = true;
          void navigate({ search: knowledgeCatalogueSearch({ kind: value }), resetScroll: false });
        }}
      />
    </AdminAiSections>
  );
}
export const Route = createFileRoute('/admin/knowledge-bases')({
  validateSearch: (raw: Record<string, unknown>) => ({
    kind: knowledgeCatalogueSearch(raw).kind === 'kb-groups' ? ('kb-groups' as const) : undefined,
    ...catalogueWorkspaceSearch(raw),
  }),
  beforeLoad: ({ search }) => {
    const recordId = search.editing ?? search.viewing;
    if (!recordId) return;
    throw redirect({
      to:
        search.kind === 'kb-groups'
          ? '/admin/knowledge-bases/groups/$recordId/{-$action}'
          : '/admin/knowledge-bases/$recordId/{-$action}',
      params: { recordId, action: search.editing && recordId !== 'new' ? 'edit' : undefined },
      replace: true,
    });
  },
  component: CatalogueRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
