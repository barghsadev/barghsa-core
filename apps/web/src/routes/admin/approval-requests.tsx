import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { isInvoiceUuid } from '../../lib/invoice-uuid.js';

export const Route = createFileRoute('/admin/approval-requests')({
  validateSearch: (search: Record<string, unknown>) => ({
    requestId:
      typeof search.requestId === 'string' && isInvoiceUuid(search.requestId)
        ? search.requestId
        : undefined,
  }),
  component: lazyRouteComponent(() => import('../../pages/AdminApprovalRequestsPage.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
