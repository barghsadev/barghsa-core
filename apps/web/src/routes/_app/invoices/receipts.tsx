import { createFileRoute } from '@tanstack/react-router';
import { BankReceiptsPage } from '../../../pages/BankReceiptsPage.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';

export const Route = createFileRoute('/_app/invoices/receipts')({
  component: BankReceiptsPage,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
