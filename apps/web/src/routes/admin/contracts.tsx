import { createFileRoute } from '@tanstack/react-router';
import AdminContractsPage from '../../pages/AdminContractsPage.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
export const Route = createFileRoute('/admin/contracts')({
  component: AdminContractsPage,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
