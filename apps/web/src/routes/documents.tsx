import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
import { RouteSkeleton } from '../components/RouteSkeleton.js'

export const Route = createFileRoute('/documents')({
  component: lazyRouteComponent(() => import('../pages/DocumentsPage.js')),
  pendingComponent: () => <RouteSkeleton />,
})