import AdminAiSections from '../../components/AdminAiSections.js';
import { useRef } from 'react';
import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { policyCatalogueSearch } from '../../lib/catalogue-category-query.js';
import { catalogueWorkspaceSearch } from '../../lib/catalogue-workspace.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminAiPoliciesPage.js'));
function CatalogueRoute() {
  const focusCategory = useRef(false);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const kind = search.kind === 'policy-groups' ? 'policy-groups' : 'policies';
  return (
    <AdminAiSections section="/admin/policies">
      <Page
        key={kind}
        initialKind={kind}
        focusCategory={focusCategory.current}
        workspace={{ view: 'list' }}
        onKindChange={(value) => {
          focusCategory.current = true;
          void navigate({ search: policyCatalogueSearch({ kind: value }), resetScroll: false });
        }}
      />
    </AdminAiSections>
  );
}
export const Route = createFileRoute('/admin/policies')({
  validateSearch: (raw: Record<string, unknown>) => ({
    kind:
      policyCatalogueSearch(raw).kind === 'policy-groups' ? ('policy-groups' as const) : undefined,
    ...catalogueWorkspaceSearch(raw),
  }),
  beforeLoad: ({ search }) => {
    const recordId = search.editing ?? search.viewing;
    if (!recordId) return;
    throw redirect({
      to:
        search.kind === 'policy-groups'
          ? '/admin/policies/groups/$recordId/{-$action}'
          : '/admin/policies/$recordId/{-$action}',
      params: { recordId, action: search.editing && recordId !== 'new' ? 'edit' : undefined },
      replace: true,
    });
  },
  component: CatalogueRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
