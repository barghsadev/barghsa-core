import { createFileRoute, notFound } from '@tanstack/react-router';
import { CatalogueRouteWorkspace } from '../../components/CatalogueRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import {
  productCatalogueLocationSearch,
  productCatalogueType,
} from '../../lib/catalogue-category-query.js';

export const Route = createFileRoute('/admin/catalogue_/$category_/new')({
  validateSearch: productCatalogueLocationSearch,
  component: WorkspaceRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function WorkspaceRoute() {
  const search = Route.useSearch();
  const { category: categoryParam } = Route.useParams();
  const category = productCatalogueType(categoryParam);
  if (!category) throw notFound();
  if (category === 'electricity') throw notFound();
  return <CatalogueRouteWorkspace category={category} view="new" search={search} />;
}
