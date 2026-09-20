import { createFileRoute } from '@tanstack/react-router';
import ContractsPage from '../../pages/ContractsPage.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
export const Route = createFileRoute('/_app/contracts')({
  component: ContractsPage,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
