import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
import { RouteSkeleton } from '../../../components/RouteSkeleton.js'
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js'

export const Route = createFileRoute('/admin/crm/profiles/$profileId')({
  component: lazyRouteComponent(() => import('../../../pages/CrmProfileDetail.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
})