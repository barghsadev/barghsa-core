import { useCallback, useRef } from 'react';
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';
import {
  productCatalogueQueryOptions,
  productCatalogueSearch,
  type ProductCatalogueType,
} from '../../lib/catalogue-category-query.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminCataloguePage.js'));
function validateSearch(raw: Record<string, unknown>) {
  const query = productCatalogueSearch(raw);
  return {
    ...query,
    selected:
      raw.selected === 'new' && query.type !== 'electricity' ? 'new' : adminEditorId(raw.selected),
  };
}

function CatalogueRoute() {
  const focusCategory = useRef(false);
  const search = validateSearch(Route.useSearch());
  const navigate = Route.useNavigate();
  const queries = useListQuery(productCatalogueQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => {
        const next = update(raw);
        return validateSearch({
          ...next,
          selected: raw.type === next.type ? next.selected : undefined,
        });
      },
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  const select = useCallback(
    (id: string | null, replace = false) => {
      void navigate({
        search: (raw) => validateSearch({ ...raw, selected: id ?? undefined }),
        replace,
        resetScroll: false,
      });
    },
    [navigate]
  );
  const type = (queries.query.filters.type || 'consultation') as ProductCatalogueType;
  return (
    <Page
      key={type}
      queries={queries}
      initialType={type}
      focusCategory={focusCategory.current}
      selection={{ id: search.selected ?? null, set: select }}
      onTypeChange={(value) => {
        focusCategory.current = true;
        queries.setQuery({ filters: { type: value } });
      }}
    />
  );
}
export const Route = createFileRoute('/admin/catalogue')({
  validateSearch: productCatalogueSearch,
  component: CatalogueRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
