import AdminAiSections from '../../components/AdminAiSections.js';
import { useCallback, useRef } from 'react';
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
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
  const address = catalogueWorkspaceSearch(search);
  const setAddress = useCallback(
    (patch: { editing?: string | null; viewing?: string | null }, replace = false) => {
      void navigate({
        search: (raw) => ({
          ...policyCatalogueSearch(raw),
          ...catalogueWorkspaceSearch({ ...raw, ...patch }),
        }),
        replace,
        resetScroll: false,
      });
    },
    [navigate]
  );
  const clear = useCallback(() => setAddress({ editing: null, viewing: null }, true), [setAddress]);
  return (
    <AdminAiSections section="/admin/policies">
      <Page
        key={kind}
        initialKind={kind}
        focusCategory={focusCategory.current}
        workspace={{
          editor: {
            id: address.editing ?? null,
            set: (id, replace) => setAddress({ editing: id }, replace),
          },
          detail: {
            id: address.viewing ?? null,
            set: (id, replace) => setAddress({ viewing: id }, replace),
          },
          clear,
        }}
        onKindChange={(value) => {
          focusCategory.current = true;
          void navigate({ search: policyCatalogueSearch({ kind: value }), resetScroll: false });
        }}
      />
    </AdminAiSections>
  );
}
export const Route = createFileRoute('/admin/policies')({
  validateSearch: policyCatalogueSearch,
  component: CatalogueRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
