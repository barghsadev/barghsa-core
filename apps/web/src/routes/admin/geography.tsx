import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import { provinceQueryOptions } from '../../lib/admin-list-query.js';
import {
  geographyId,
  geographyListSearch,
  geographyRecordSearch,
} from '../../lib/geography-location.js';

const Geography = lazyRouteComponent(() => import('../../pages/AdminGeographyPage.js'));

function GeographyRoute() {
  const search = geographyListSearch(Route.useSearch());
  const navigate = Route.useNavigate();
  const provinces = useListQuery(provinceQueryOptions, search, (change, options) => {
    void navigate({
      search: (current) => geographyListSearch(change(current)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Geography query={provinces} routeSearch={search} />;
}

export const Route = createFileRoute('/admin/geography')({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...geographyRecordSearch(raw),
    province: geographyId(raw.province),
    provinceEditor: geographyId(raw.provinceEditor),
    cityEditor: geographyId(raw.cityEditor),
  }),
  beforeLoad: ({ search }) => {
    const { province, provinceEditor, cityEditor } = search;
    if (provinceEditor) {
      throw redirect({
        to: '/admin/geography/provinces/$provinceId/{-$action}',
        params: {
          provinceId: provinceEditor,
          ...(provinceEditor !== 'new' ? { action: 'edit' } : {}),
        },
        search: geographyRecordSearch(search),
        replace: true,
      });
    }
    if (province && cityEditor) {
      throw redirect({
        to: '/admin/geography/provinces/$provinceId/cities/$cityId/{-$action}',
        params: {
          provinceId: province,
          cityId: cityEditor,
          ...(cityEditor !== 'new' ? { action: 'edit' } : {}),
        },
        search: geographyRecordSearch(search),
        replace: true,
      });
    }
    if (province) {
      throw redirect({
        to: '/admin/geography/provinces/$provinceId/{-$action}',
        params: { provinceId: province },
        search: geographyRecordSearch(search),
        replace: true,
      });
    }
  },
  component: GeographyRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
