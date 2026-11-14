import { createFileRoute } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import AdminOperationalRetentionPage from '../../pages/AdminOperationalRetentionPage.js';

export const Route = createFileRoute('/admin/operational-retention')({
  component: AdminOperationalRetentionPage,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
