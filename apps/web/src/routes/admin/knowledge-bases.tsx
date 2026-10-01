import { useRef } from 'react';
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  knowledgeCatalogueQueryOptions,
  knowledgeCatalogueSearch,
  type KnowledgeCatalogueKind,
} from '../../lib/catalogue-category-query.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminKnowledgeBasesPage.js'));
function CatalogueRoute() {
  const focusCategory = useRef(false);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(knowledgeCatalogueQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => knowledgeCatalogueSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  const kind = (queries.query.filters.kind || 'knowledge-bases') as KnowledgeCatalogueKind;
  return (
    <Page
      key={kind}
      initialKind={kind}
      focusCategory={focusCategory.current}
      onKindChange={(value) => {
        focusCategory.current = true;
        queries.setQuery({ filters: { kind: value } });
      }}
    />
  );
}
export const Route = createFileRoute('/admin/knowledge-bases')({
  validateSearch: knowledgeCatalogueSearch,
  component: CatalogueRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
