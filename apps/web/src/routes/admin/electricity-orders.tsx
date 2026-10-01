import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery, writeListQuery } from '../../hooks/useListQuery.js';
import {
  electricityQueueOptions,
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
      search: (current) => electricityOrdersSearch(update(current)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const queue = useListQuery(electricityQueueOptions, search, change);
  return (
    <Orders
      queries={{
        queue,
        selected: typeof search.orderId === 'string' ? search.orderId : null,
        select: (id, replace = false) =>
          change((current) => ({ ...current, orderId: id ?? undefined }), { replace }),
        changeLane: (value) =>
          change((current) => ({
            ...writeListQuery(current, electricityQueueOptions, { filters: { view: value } }),
            orderId: undefined,
          })),
      }}
    />
  );
}
export const Route = createFileRoute('/admin/electricity-orders')({
  validateSearch: electricityOrdersSearch,
  component: ElectricityOrdersRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
