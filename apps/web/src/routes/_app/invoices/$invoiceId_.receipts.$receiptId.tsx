import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { receiptHistorySearch } from '../../../lib/receipt-history-search.js';

const InvoiceReceiptPage = lazyRouteComponent(
  () => import('../../../pages/InvoiceReceiptPage.js'),
  'InvoiceReceiptPage'
);

export const Route = createFileRoute('/_app/invoices/$invoiceId_/receipts/$receiptId')({
  validateSearch: receiptHistorySearch,
  component: InvoiceReceiptRoute,
});

function InvoiceReceiptRoute() {
  const { invoiceId, receiptId } = Route.useParams();
  return (
    <InvoiceReceiptPage
      invoiceId={invoiceId}
      receiptId={receiptId}
      historySearch={Route.useSearch()}
    />
  );
}
