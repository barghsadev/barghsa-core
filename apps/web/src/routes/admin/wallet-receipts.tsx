import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
import { RouteSkeleton } from '../../components/RouteSkeleton.js'
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js'

export const Route = createFileRoute('/admin/wallet-receipts')({
  component: lazyRouteComponent(() => import('../../pages/AdminWalletReceiptsPage.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
})
