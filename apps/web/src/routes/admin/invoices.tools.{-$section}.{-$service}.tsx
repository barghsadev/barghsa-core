import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { invoiceQueueSearch } from '../../lib/finance-list-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminInvoiceToolsPage.js'));

function InvoiceToolsRoute() {
  const { section, service } = Route.useParams();
  return <Page section={section} serviceParam={service} search={Route.useSearch()} />;
}

export const Route = createFileRoute('/admin/invoices/tools/{-$section}/{-$service}')({
  validateSearch: invoiceQueueSearch,
  component: InvoiceToolsRoute,
  pendingComponent: StaffRecordLoading,
});
