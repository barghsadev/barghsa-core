import { createFileRoute, notFound } from '@tanstack/react-router';
import { CatalogueRouteWorkspace } from '../../components/CatalogueRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import {
  productCatalogueLocationSearch,
  productCatalogueType,
} from '../../lib/catalogue-category-query.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';

export const Route = createFileRoute('/admin/catalogue_/$category_/$productId')({
  validateSearch: productCatalogueLocationSearch,
  component: WorkspaceRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function WorkspaceRoute() {
  const search = Route.useSearch();
  const { category: categoryParam, productId: idParam } = Route.useParams();
  const category = productCatalogueType(categoryParam);
  if (!category) throw notFound();
  const productId = adminEditorId(idParam);
  if (!productId) throw notFound();
  return (
    <CatalogueRouteWorkspace
      category={category}
      view="detail"
      search={search}
      productId={productId}
    />
  );
}
