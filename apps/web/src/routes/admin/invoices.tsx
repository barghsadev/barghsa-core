import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
import { RouteSkeleton } from '../../components/RouteSkeleton.js'
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js'

export const Route = createFileRoute('/admin/invoices')({
  component: lazyRouteComponent(() => import('../../pages/AdminInvoicesPage.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
})
