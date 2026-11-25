import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { useListQuery, writeListQuery } from '../../hooks/useListQuery.js';
import {
  electricityQueueOptions,
  electricityOrderFilters,
  electricityOrdersSearch,
} from '../../lib/staff-order-list-query.js';

const Orders = lazyRouteComponent(() => import('../../pages/AdminElectricityOrdersPage.js'));
function ElectricityOrdersRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const change = (
    update: (current: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (current) => electricityOrderFilters(update(current)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const queue = useListQuery(electricityQueueOptions, search, change);
  return (
    <Orders
      queueSearch={electricityOrderFilters(search)}
      queries={{
        queue,
        selected: null,
        select: (orderId) => {
          if (orderId)
            void navigate({
              to: '/admin/electricity-orders/$orderId',
              params: { orderId },
              search: electricityOrderFilters(search),
            });
        },
        changeLane: (value) =>
          change((current) => ({
            ...writeListQuery(current, electricityQueueOptions, { filters: { view: value } }),
            orderId: undefined,
          })),
      }}
    />
  );
}
export const Route = createFileRoute('/admin/electricity-orders/')({
  validateSearch: electricityOrdersSearch,
  beforeLoad: ({ search }) => {
    if (search.orderId)
      throw redirect({
        to: '/admin/electricity-orders/$orderId',
        params: { orderId: search.orderId },
        search: electricityOrderFilters(search),
        replace: true,
      });
  },
  component: ElectricityOrdersRoute,
  pendingComponent: StaffRecordLoading,
});
