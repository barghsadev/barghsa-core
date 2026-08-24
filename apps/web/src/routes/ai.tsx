import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
import { RouteSkeleton } from '../components/RouteSkeleton.js'
import { RouteErrorBoundary } from '../components/RouteErrorBoundary.js'

export const Route = createFileRoute('/ai')({
  component: lazyRouteComponent(() => import('../pages/AIChat.js')),
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
})