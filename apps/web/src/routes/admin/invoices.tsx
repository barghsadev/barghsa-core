import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  invoiceListsSearch,
  invoiceLedgerQueryOptions,
  invoiceReceiptQueryOptions,
} from '../../lib/finance-list-query.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Invoices = lazyRouteComponent(() => import('../../pages/AdminInvoicesPage.js'));
function InvoicesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const change = (
    update: (current: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (current) => invoiceListsSearch(update(current)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const ledger = useListQuery(invoiceLedgerQueryOptions, search, change);
  const history = useListQuery(invoiceReceiptQueryOptions, search, change);
  return (
    <Invoices
      queries={{
        ledger,
        history: {
          query: history,
          open: search.receiptHistory === 'true',
          setOpen: (value) => change((current) => ({ ...current, receiptHistory: String(value) })),
        },
        receiptsOpen: search.receipts === 'true',
        setReceiptsOpen: (value, historyOpen) =>
          change((current) => ({
            ...current,
            receipts: String(value),
            ...(historyOpen === undefined ? {} : { receiptHistory: String(historyOpen) }),
          })),
      }}
    />
  );
}

export const Route = createFileRoute('/admin/invoices')({
  validateSearch: invoiceListsSearch,
  component: InvoicesRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
