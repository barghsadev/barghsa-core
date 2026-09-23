import { createFileRoute } from '@tanstack/react-router';
import { InvoicesPage } from '../../../pages/InvoicesPage.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';

function InvoiceListRoute() {
  const { status } = Route.useSearch();
  return <InvoicesPage key={status ?? 'all'} unpaidOnly={status === 'unpaid'} />;
}

export const Route = createFileRoute('/_app/invoices/')({
  validateSearch: (search: Record<string, unknown>) => ({
    status: search.status === 'unpaid' ? ('unpaid' as const) : undefined,
  }),
  component: InvoiceListRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
