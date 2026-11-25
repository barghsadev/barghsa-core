import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  invoiceListsSearch,
  invoiceQueueSearch,
  invoiceLedgerQueryOptions,
  invoiceReceiptQueryOptions,
  pendingReceiptQueryOptions,
} from '../../lib/finance-list-query.js';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';

const Invoices = lazyRouteComponent(() => import('../../pages/AdminInvoicesPage.js'));
function InvoicesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const recordSearch = invoiceQueueSearch(search);
  const change = (
    update: (current: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (current) => invoiceQueueSearch(update(current)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const ledger = useListQuery(invoiceLedgerQueryOptions, search, change);
  const pending = useListQuery(pendingReceiptQueryOptions, search, change);
  const history = useListQuery(invoiceReceiptQueryOptions, search, change);
  return (
    <Invoices
      recordSearch={recordSearch}
      onLookupInvoice={(invoiceId) =>
        void navigate({
          to: '/admin/invoices/$invoiceId',
          params: { invoiceId },
          search: recordSearch,
        })
      }
      onOpenReceiptRecord={(receiptId) =>
        void navigate({
          to: '/admin/invoices/receipts/$receiptId/{-$decision}',
          params: { receiptId, decision: undefined },
          search: recordSearch,
        })
      }
      queries={{
        ledger,
        pending,
        history: {
          query: history,
          open: search.receiptHistory === 'true',
          setOpen: (value) => change((current) => ({ ...current, receiptHistory: String(value) })),
        },
        receiptsOpen: search.receipts === 'true',
        setReceiptsOpen: (value) => change((current) => ({ ...current, receipts: String(value) })),
      }}
    />
  );
}

export const Route = createFileRoute('/admin/invoices/')({
  validateSearch: invoiceListsSearch,
  beforeLoad: async ({ search, location }) => {
    if (search.invoiceId || location.hash.startsWith('invoice-')) {
      const { redirectLegacyInvoiceList } = await import('../../lib/invoice-refund-route.js');
      redirectLegacyInvoiceList(search, location.hash);
    }
  },
  component: InvoicesRoute,
  pendingComponent: StaffRecordLoading,
});
