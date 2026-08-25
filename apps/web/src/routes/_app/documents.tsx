import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
import { RouteSkeleton } from '../../components/RouteSkeleton.js'
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js'

export const Route = createFileRoute('/_app/documents')({
  component: lazyRouteComponent(() => import('../../pages/DocumentsPage.js')),
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
})