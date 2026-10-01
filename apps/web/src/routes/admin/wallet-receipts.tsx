import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import { pendingReceiptQueryOptions, pendingReceiptSearch } from '../../lib/finance-list-query.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
const WalletReceipts = lazyRouteComponent(() => import('../../pages/AdminWalletReceiptsPage.js'));
function WalletReceiptsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const binding = useListQuery(
    pendingReceiptQueryOptions,
    search,
    (update, options) =>
      void navigate({
        search: (current) => pendingReceiptSearch(update(current)),
        replace: options?.replace ?? false,
        resetScroll: false,
      })
  );
  return <WalletReceipts binding={binding} />;
}
export const Route = createFileRoute('/admin/wallet-receipts')({
  validateSearch: pendingReceiptSearch,
  component: WalletReceiptsRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
