import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import { cityQueryOptions } from '../../lib/admin-list-query.js';
import { geographyId, geographyRecordSearch } from '../../lib/geography-location.js';

const GeographyRecord = lazyRouteComponent(() => import('../../pages/AdminGeographyRecordPage.js'));

function ProvinceRoute() {
  const search = Route.useSearch();
  const { provinceId, action } = Route.useParams();
  const navigate = Route.useNavigate();
  const cityQuery = useListQuery(cityQueryOptions, search, (change, options) => {
    void navigate({
      search: (current) => geographyRecordSearch(change(current)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  if (!geographyId(provinceId) || (action && (action !== 'edit' || provinceId === 'new')))
    throw notFound();
  return (
    <GeographyRecord
      provinceId={provinceId}
      edit={action === 'edit'}
      search={search}
      cityQuery={cityQuery}
    />
  );
}

export const Route = createFileRoute('/admin/geography_/provinces/$provinceId/{-$action}')({
  validateSearch: geographyRecordSearch,
  component: ProvinceRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
