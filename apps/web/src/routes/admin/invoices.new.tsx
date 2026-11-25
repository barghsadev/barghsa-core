import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { tManualInvoice } from '@barghsa/i18n/manual-invoice';
import ManualInvoicePanel from '../../components/ManualInvoicePanel.js';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { invoiceQueueSearch } from '../../lib/finance-list-query.js';
import { useLocale } from '../../hooks/useLocale.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminInvoiceRecordPage.js'));

function InvoiceRoute() {
  const search = Route.useSearch();
  const locale = useLocale();
  return (
    <Page
      entry={{
        mode: 'new',
        title: tManualInvoice('admin.manualInvoice.new', locale),
        Form: ManualInvoicePanel,
      }}
      search={search}
    />
  );
}

export const Route = createFileRoute('/admin/invoices/new')({
  validateSearch: invoiceQueueSearch,
  component: InvoiceRoute,
  pendingComponent: StaffRecordLoading,
});
