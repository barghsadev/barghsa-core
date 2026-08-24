import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
import { RouteSkeleton } from '../components/RouteSkeleton.js'

export const Route = createFileRoute('/videos')({
  component: lazyRouteComponent(() => import('../pages/VideosPage.js')),
  pendingComponent: () => <RouteSkeleton />,
})