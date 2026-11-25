import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { invoiceQueueSearch } from '../../lib/finance-list-query.js';
import {
  invoiceRefundDestination,
  invoiceRefundOperation,
} from '../../lib/invoice-refund-route.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminInvoiceRecordPage.js'));
const DeadlinePanel = lazyRouteComponent(() => import('../../components/InvoiceDueAtPanel.js'));

function InvoiceActionRoute() {
  const { invoiceId, action, destination, view, operation } = Route.useParams();
  const search = Route.useSearch();
  if (action !== 'deadline' && action !== 'refunds' && action !== 'correction') throw notFound();
  if (action === 'refunds') {
    const refundOperation = invoiceRefundOperation(operation);
    return (
      <Page
        entry={{
          mode: action,
          invoiceId,
          destination: invoiceRefundDestination(destination),
          request: view === 'new',
          ...(view && refundOperation
            ? { refundDecision: { refundId: view, operation: refundOperation } }
            : {}),
        }}
        search={search}
      />
    );
  }
  return (
    <Page
      entry={
        action === 'deadline'
          ? { mode: action, invoiceId, Panel: DeadlinePanel }
          : { mode: action, invoiceId }
      }
      search={search}
    />
  );
}

export const Route = createFileRoute(
  '/admin/invoices/$invoiceId/$action/{-$destination}/{-$view}/{-$operation}'
)({
  validateSearch: invoiceQueueSearch,
  beforeLoad: ({ params, search, location }) =>
    import('../../lib/invoice-refund-route.js').then(({ validateInvoiceAction }) =>
      validateInvoiceAction(params, search, location.hash)
    ),
  component: InvoiceActionRoute,
  pendingComponent: StaffRecordLoading,
});
