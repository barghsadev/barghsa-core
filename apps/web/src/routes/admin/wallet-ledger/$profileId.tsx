import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../../hooks/useListQuery.js';
import {
  walletHistoryQueryOptions,
  walletHistorySearch,
} from '../../../lib/wallet-history-query.js';

const Page = lazyRouteComponent(() => import('../../../pages/StaffWalletLedgerPage.js'));
function LedgerRoute() {
  const { profileId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(walletHistoryQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => walletHistorySearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page profileId={profileId} queries={queries} />;
}
export const Route = createFileRoute('/admin/wallet-ledger/$profileId')({
  validateSearch: walletHistorySearch,
  component: LedgerRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
