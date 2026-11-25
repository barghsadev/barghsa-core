import { createFileRoute } from '@tanstack/react-router';
import { CatalogueRouteWorkspace } from '../../components/CatalogueRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary, RouteNotFound } from '../../components/RouteErrorBoundary.js';
import {
  productCatalogueLocationSearch,
  productCatalogueType,
} from '../../lib/catalogue-category-query.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';

export const Route = createFileRoute(
  '/admin/catalogue_/$category_/$productId_/configuration/{-$operation}'
)({
  validateSearch: productCatalogueLocationSearch,
  component: WorkspaceRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function WorkspaceRoute() {
  const search = Route.useSearch();
  const { category: categoryParam, productId: idParam, operation } = Route.useParams();
  const category = productCatalogueType(categoryParam);
  const productId = adminEditorId(idParam);
  if (
    !productId ||
    (category !== 'saving_plan' && category !== 'hardware') ||
    (operation &&
      (category !== 'saving_plan' ||
        (operation !== 'agreement' && operation !== 'activate-agreement')))
  )
    return <RouteNotFound />;
  return (
    <CatalogueRouteWorkspace
      category={category}
      view="configuration"
      search={search}
      productId={productId}
      {...(operation && { configurationEditor: operation })}
    />
  );
}
