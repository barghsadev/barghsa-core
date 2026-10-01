import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery, writeListQuery } from '../../hooks/useListQuery.js';
import { savingQueueOptions, savingOrdersSearch } from '../../lib/staff-order-list-query.js';

const Orders = lazyRouteComponent(() => import('../../pages/AdminSavingOrdersPage.js'));
function SavingOrdersRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const change = (
    update: (current: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (current) => savingOrdersSearch(update(current)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const queue = useListQuery(savingQueueOptions, search, change);
  return (
    <Orders
      queries={{
        queue,
        selected: typeof search.orderId === 'string' ? search.orderId : null,
        select: (id, replace = false) =>
          change((current) => ({ ...current, orderId: id ?? undefined }), { replace }),
        changeLane: (value) =>
          change((current) => ({
            ...writeListQuery(current, savingQueueOptions, { filters: { lane: value } }),
            orderId: undefined,
          })),
      }}
    />
  );
}
export const Route = createFileRoute('/admin/saving-orders')({
  validateSearch: savingOrdersSearch,
  component: SavingOrdersRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
