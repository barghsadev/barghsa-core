import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery, writeListQuery } from '../../hooks/useListQuery.js';
import {
  geographySearch,
  changeGeographySearch,
  provinceQueryOptions,
  cityQueryOptions,
} from '../../lib/admin-list-query.js';

const Geography = lazyRouteComponent(() => import('../../pages/AdminGeographyPage.js'));
function GeographyRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const change = (
    update: (current: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (current) => changeGeographySearch(current, update(current)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const provinces = useListQuery(provinceQueryOptions, search, change);
  const cities = useListQuery(cityQueryOptions, search, change);
  const setExpanded = (province: string | null, replace = false) =>
    change(
      (current) => ({
        ...writeListQuery(current, cityQueryOptions, {
          search: '',
          filters: { status: '' },
          page: 1,
        }),
        province: province || undefined,
      }),
      { replace }
    );
  return (
    <Geography
      query={{
        provinces,
        cities,
        expanded: typeof search.province === 'string' ? search.province : null,
        setExpanded,
        clear: () => change(() => ({}), { replace: true }),
      }}
    />
  );
}

export const Route = createFileRoute('/admin/geography')({
  validateSearch: geographySearch,
  component: GeographyRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
