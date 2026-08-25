import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
import { RouteSkeleton } from '../../components/RouteSkeleton.js'
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js'

export const Route = createFileRoute('/_app/charts')({
  component: lazyRouteComponent(() => import('../../pages/ChartsPage.js')),
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
})