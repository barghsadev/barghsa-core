import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
import { RouteSkeleton } from '../../components/RouteSkeleton.js'
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js'

export const Route = createFileRoute('/admin/roles')({
  component: lazyRouteComponent(() => import('../../pages/AdminRolesPage.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
})
