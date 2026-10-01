import { useRef } from 'react';
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  productCatalogueQueryOptions,
  productCatalogueSearch,
  type ProductCatalogueType,
} from '../../lib/catalogue-category-query.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminCataloguePage.js'));
function CatalogueRoute() {
  const focusCategory = useRef(false);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(productCatalogueQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => productCatalogueSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  const type = (queries.query.filters.type || 'consultation') as ProductCatalogueType;
  return (
    <Page
      key={type}
      initialType={type}
      focusCategory={focusCategory.current}
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
