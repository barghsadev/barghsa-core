import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { geographyId, geographyRecordSearch } from '../../lib/geography-location.js';

const GeographyRecord = lazyRouteComponent(() => import('../../pages/AdminGeographyRecordPage.js'));

function CityRoute() {
  const search = Route.useSearch();
  const { provinceId, cityId, action } = Route.useParams();
  if (
    !geographyId(provinceId) ||
    provinceId === 'new' ||
    !geographyId(cityId) ||
    (action && (action !== 'edit' || cityId === 'new' || cityId === 'import'))
  )
    throw notFound();
  return (
    <GeographyRecord
      provinceId={provinceId}
      cityId={cityId}
      edit={action === 'edit'}
      search={search}
    />
  );
}

export const Route = createFileRoute(
  '/admin/geography_/provinces/$provinceId/cities/$cityId/{-$action}'
)({
  validateSearch: geographyRecordSearch,
  component: CityRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
