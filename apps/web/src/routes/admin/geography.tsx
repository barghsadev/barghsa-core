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

function editorId(raw: unknown) {
  return typeof raw === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(raw) ? raw : undefined;
}

function GeographyRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const change = (
    update: (current: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (current) => {
        const proposed = update(current);
        const next = changeGeographySearch(current, proposed);
        const provincesChanged = ['q', 'status', 'page'].some((key) => current[key] !== next[key]);
        const citiesChanged =
          provincesChanged ||
          ['province', 'city_q', 'city_status', 'city_page'].some(
            (key) => current[key] !== next[key]
          );
        return {
          ...next,
          provinceEditor: provincesChanged ? undefined : editorId(proposed.provinceEditor),
          cityEditor: !next.province || citiesChanged ? undefined : editorId(proposed.cityEditor),
        };
      },
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const provinces = useListQuery(provinceQueryOptions, search, change);
  const cities = useListQuery(cityQueryOptions, search, change);
  const provinceEditor = editorId(search.provinceEditor) ?? null;
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
        provinceEditor: {
          id: provinceEditor,
          set: (id, replace = false) =>
            change(
              (current) => ({
                ...current,
                provinceEditor: id,
                ...(id ? { cityEditor: undefined } : {}),
              }),
              { replace }
            ),
        },
        cityEditor: {
          id: provinceEditor ? null : (editorId(search.cityEditor) ?? null),
          set: (id, replace = false) =>
            change(
              (current) => ({
                ...current,
                cityEditor: id,
                ...(id ? { provinceEditor: undefined } : {}),
              }),
              { replace }
            ),
        },
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
