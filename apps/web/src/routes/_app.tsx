import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
import { RouteSkeleton } from '../components/RouteSkeleton.js'
import { RouteErrorBoundary } from '../components/RouteErrorBoundary.js'

/**
 * Customer dashboard layout — renders the dashboard sidebar (with profile
 * switcher) around all authenticated customer pages (T-03.03.01).
 */
export const Route = createFileRoute('/_app')({
  component: lazyRouteComponent(() => import('../pages/DashboardLayout.js')),
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
})