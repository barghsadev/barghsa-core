import { createFileRoute } from '@tanstack/react-router';
import { InvoiceDetailsPage } from '../../../pages/InvoiceDetailsPage.js';

export const Route = createFileRoute('/_app/invoices/$invoiceId')({
  component: InvoiceDetailsRoute,
});

function InvoiceDetailsRoute() {
  const { invoiceId } = Route.useParams();
  return <InvoiceDetailsPage invoiceId={invoiceId} />;
}
