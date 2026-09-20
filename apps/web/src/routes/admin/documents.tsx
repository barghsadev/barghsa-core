import { createFileRoute } from '@tanstack/react-router';
import AdminDocumentsPage from '../../pages/AdminDocumentsPage.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

export const Route = createFileRoute('/admin/documents')({
  component: AdminDocumentsPage,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
