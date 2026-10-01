import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useListQuery, writeListQuery } from '../../hooks/useListQuery.js';
import { consultationQueryOptions, consultationSearch } from '../../lib/support-list-query.js';

const Consultations = lazyRouteComponent(
  () => import('../../pages/AdminConsultationsPage.js'),
  'AdminConsultationsPage'
);
function ConsultationsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const change = (
    update: (raw: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (raw) => consultationSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const queue = useListQuery(consultationQueryOptions, search, change);
  return (
    <Consultations
      queries={{
        queue,
        selected: typeof search.requestId === 'string' ? search.requestId : null,
        select: (id, replace = false) =>
          change((raw) => ({ ...raw, requestId: id ?? undefined }), { replace }),
        setFilters: (filters) =>
          change((raw) => ({
            ...writeListQuery(raw, consultationQueryOptions, { filters }),
            requestId: undefined,
          })),
      }}
    />
  );
}
export const Route = createFileRoute('/admin/consultations')({
  validateSearch: consultationSearch,
  component: ConsultationsRoute,
});
