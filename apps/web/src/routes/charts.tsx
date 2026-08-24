import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
import { RouteSkeleton } from '../components/RouteSkeleton.js'

export const Route = createFileRoute('/charts')({
  component: lazyRouteComponent(() => import('../pages/ChartsPage.js')),
  pendingComponent: () => <RouteSkeleton />,
})