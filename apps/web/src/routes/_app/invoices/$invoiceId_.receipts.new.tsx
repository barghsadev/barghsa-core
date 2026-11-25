import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { InvoiceDetailsPage } from '../../../pages/InvoiceDetailsPage.js';

const ReceiptForm = lazyRouteComponent(
  () => import('../../../pages/InvoiceBankReceiptUploadForm.js'),
  'InvoiceBankReceiptUploadForm'
);

export const Route = createFileRoute('/_app/invoices/$invoiceId_/receipts/new')({
  component: InvoiceReceiptNewRoute,
});

function InvoiceReceiptNewRoute() {
  const { invoiceId } = Route.useParams();
  return <InvoiceDetailsPage invoiceId={invoiceId} ReceiptForm={ReceiptForm} />;
}
