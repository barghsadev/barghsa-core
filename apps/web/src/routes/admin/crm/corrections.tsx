import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';
import { crmCorrectionSearch } from '../../../lib/crm-correction-query.js';
export const Route = createFileRoute('/admin/crm/corrections')({
  validateSearch: crmCorrectionSearch,
  component: lazyRouteComponent(
    () => import('../../../pages/CrmCorrectionsPage.js'),
    'CrmCorrectionsRoutePage'
  ),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
