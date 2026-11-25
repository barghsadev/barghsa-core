import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { useListQuery, writeListQuery } from '../../hooks/useListQuery.js';
import {
  savingOrderFilters,
  savingQueueOptions,
  savingOrdersSearch,
} from '../../lib/staff-order-list-query.js';

const Orders = lazyRouteComponent(() => import('../../pages/AdminSavingOrdersPage.js'));
function SavingOrdersRoute() {
  const search = Route.useSearch();
  const queueSearch = savingOrderFilters(search);
  const navigate = Route.useNavigate();
  const change = (
    update: (current: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (current) => savingOrderFilters(update(current)),
      replace: options?.replace,
      resetScroll: false,
    });
  const queue = useListQuery(savingQueueOptions, search, change);
  return (
    <Orders
      queueSearch={queueSearch}
      queries={{
        queue,
        selected: null,
        select: (orderId) => {
          if (orderId)
            void navigate({
              to: '/admin/saving-orders/$orderId/{-$operation}/{-$upgradeId}',
              params: { orderId },
              search: queueSearch,
            });
        },
        changeLane: (value) =>
          change((current) =>
            writeListQuery(current, savingQueueOptions, { filters: { lane: value } })
          ),
      }}
    />
  );
}
export const Route = createFileRoute('/admin/saving-orders/')({
  validateSearch: savingOrdersSearch,
  beforeLoad: ({ search }) => {
    if (search.orderId)
      throw redirect({
        to: '/admin/saving-orders/$orderId/{-$operation}/{-$upgradeId}',
        params: { orderId: search.orderId },
        search: savingOrderFilters(search),
        replace: true,
      });
  },
  component: SavingOrdersRoute,
  pendingComponent: StaffRecordLoading,
});
