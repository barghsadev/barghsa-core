import { createFileRoute } from '@tanstack/react-router';
import { BANK_RECEIPT_STATUSES, parseStatusFilter } from '@barghsa/shared/validation';
import { BankReceiptsPage } from '../../../pages/BankReceiptsPage.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';

export const Route = createFileRoute('/_app/invoices/receipts')({
  validateSearch: (search: Record<string, unknown>) => ({
    statuses:
      (parseStatusFilter(search.statuses ?? search.state, BANK_RECEIPT_STATUSES) ?? []).join(',') ||
      undefined,
  }),
  component: ReceiptsRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});

function ReceiptsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <BankReceiptsPage
      statuses={parseStatusFilter(search.statuses, BANK_RECEIPT_STATUSES) ?? []}
      onStatusesChange={(statuses) => {
        void navigate({ search: { statuses: statuses.join(',') || undefined } });
      }}
    />
  );
}
