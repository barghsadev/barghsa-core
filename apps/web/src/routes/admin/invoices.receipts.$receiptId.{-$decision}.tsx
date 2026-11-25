import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { invoiceQueueSearch } from '../../lib/finance-list-query.js';
import { isInvoiceUuid } from '../../lib/invoice-uuid.js';
import { invoiceReceiptDecision } from '../../lib/invoice-receipt-decision.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminInvoiceRecordPage.js'));
const ReceiptPanel = lazyRouteComponent(
  () => import('../../components/InvoiceBankReceiptQueue.js'),
  'InvoiceBankReceiptQueue'
);

function InvoiceRoute() {
  const { receiptId, decision } = Route.useParams();
  return (
    <Page
      entry={{
        mode: 'receipt',
        receiptId,
        decision: invoiceReceiptDecision(decision),
        Panel: ReceiptPanel,
      }}
      search={Route.useSearch()}
    />
  );
}

export const Route = createFileRoute('/admin/invoices/receipts/$receiptId/{-$decision}')({
  validateSearch: invoiceQueueSearch,
  beforeLoad: ({ params, search, location }) => {
    const receiptId = params.receiptId.trim().toLowerCase();
    const decision = invoiceReceiptDecision(params.decision);
    if (!isInvoiceUuid(receiptId) || (params.decision && !decision)) throw notFound();
    if (receiptId !== params.receiptId) {
      throw redirect({
        to: '/admin/invoices/receipts/$receiptId/{-$decision}',
        params: { receiptId, decision },
        search,
        hash: location.hash,
        replace: true,
      });
    }
  },
  component: InvoiceRoute,
  pendingComponent: StaffRecordLoading,
});
