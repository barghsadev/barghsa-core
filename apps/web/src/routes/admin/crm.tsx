import { createFileRoute, lazyRouteComponent, Outlet } from '@tanstack/react-router'
import { RouteSkeleton } from '../../components/RouteSkeleton.js'
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js'

/**
 * CRM layout route under admin — renders child CRM pages.
 */
export const Route = createFileRoute('/admin/crm')({
  component: lazyRouteComponent(() => import('../../pages/CrmLayout.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
})