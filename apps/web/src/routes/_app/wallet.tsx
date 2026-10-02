import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { createFileRoute, useSearch } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import { walletHistoryQueryOptions, walletHistorySearch } from '../../lib/wallet-history-query.js';
import { useProfileContextReset } from '../../lib/profile-context.js';
import { WalletPage } from '../../pages/WalletPage.js';
import { isInvoiceUuid } from '../../lib/invoice-uuid.js';
import { walletInvoiceReturnFor } from '../../lib/wallet-invoice-return.js';

export const Route = createFileRoute('/_app/wallet')({
  component: WalletRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
  validateSearch: walletHistorySearch,
});

function WalletRoute() {
  // Return-query handling belongs to this route's component chunk, not the shared bootstrap.
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = Route.useNavigate();
  const history = useListQuery(
    walletHistoryQueryOptions,
    search,
    (update, options) =>
      void navigate({
        search: (current) => walletHistorySearch(update(current)),
        replace: options?.replace ?? false,
        resetScroll: false,
      })
  );
  useProfileContextReset(() => history.setQuery({ cursor: '' }, true));
  const directReturnInvoiceId =
    typeof search.returnInvoiceId === 'string' && isInvoiceUuid(search.returnInvoiceId)
      ? search.returnInvoiceId
      : undefined;
  const orderId = search.paymentOrderId;
  const authority = search.paymentAuthority;
  const paymentReturn =
    typeof orderId === 'string' &&
    orderId.length > 0 &&
    orderId.length <= 128 &&
    typeof authority === 'string' &&
    authority.length > 0 &&
    authority.length <= 512
      ? { orderId, authority }
      : undefined;
  const returnInvoiceId =
    directReturnInvoiceId ??
    (paymentReturn ? walletInvoiceReturnFor(paymentReturn.orderId) : null) ??
    undefined;
  return (
    <WalletPage
      paymentReturn={paymentReturn}
      returnInvoiceId={returnInvoiceId}
      historyQuery={history}
    />
  );
}
