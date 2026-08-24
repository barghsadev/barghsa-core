import { createFileRoute, lazyRouteComponent, Outlet } from '@tanstack/react-router'
import { RouteSkeleton } from '../components/RouteSkeleton.js'
import { RouteErrorBoundary } from '../components/RouteErrorBoundary.js'

/**
 * Admin layout — renders sidebar navigation with lazy-loaded child routes.
 */
export const Route = createFileRoute('/admin')({
  component: lazyRouteComponent(() => import('../pages/AdminLayout.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
})