import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { useListQuery, writeListQuery } from '../../hooks/useListQuery.js';
import {
  consultationFilters,
  consultationQueryOptions,
  consultationSearch,
} from '../../lib/support-list-query.js';

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
      search: (raw) => consultationFilters(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const queue = useListQuery(consultationQueryOptions, search, change);
  return (
    <Consultations
      recordSearch={consultationFilters(search)}
      queries={{
        queue,
        setFilters: (filters) =>
          change((raw) => writeListQuery(raw, consultationQueryOptions, { filters })),
      }}
    />
  );
}
export const Route = createFileRoute('/admin/consultations/')({
  validateSearch: consultationSearch,
  beforeLoad: ({ search }) => {
    if (search.requestId)
      throw redirect({
        to: '/admin/consultations/$requestId',
        params: { requestId: search.requestId },
        search: consultationFilters(search),
        replace: true,
      });
  },
  component: ConsultationsRoute,
});
