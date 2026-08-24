import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
import { RouteSkeleton } from '../../components/RouteSkeleton.js'

export const Route = createFileRoute('/admin/users')({
  component: lazyRouteComponent(() => import('../../pages/AdminDashboard.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
})