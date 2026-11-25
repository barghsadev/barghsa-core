import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { invoiceQueueSearch } from '../../lib/finance-list-query.js';
import { isInvoiceUuid } from '../../lib/invoice-uuid.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminInvoiceRecordPage.js'));

function InvoiceRoute() {
  const { invoiceId } = Route.useParams();
  return <Page entry={{ mode: 'detail', invoiceId }} search={Route.useSearch()} />;
}

export const Route = createFileRoute('/admin/invoices/$invoiceId/')({
  validateSearch: invoiceQueueSearch,
  beforeLoad: ({ params, search, location }) => {
    const invoiceId = params.invoiceId.trim().toLowerCase();
    if (!isInvoiceUuid(invoiceId)) throw notFound();
    if (invoiceId !== params.invoiceId) {
      throw redirect({
        to: '/admin/invoices/$invoiceId',
        params: { invoiceId },
        search,
        hash: location.hash,
        replace: true,
      });
    }
  },
  component: InvoiceRoute,
  pendingComponent: StaffRecordLoading,
});
