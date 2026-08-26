import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
import { RouteSkeleton } from '../../../components/RouteSkeleton.js'
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js'

/**
 * CRM profile list route — index under /admin/crm.
 *
 * Declares the optional `verification` search param so the Admin Dashboard
 * "Show all" link (`/admin/crm?verification=PENDING`) resolves correctly and
 * type-checks. The full list view is a separate task; the index page renders
 * a placeholder for now.
 */
const verifySearch = (search: Record<string, unknown>) => ({
  verification: typeof search.verification === 'string' ? search.verification : undefined,
})

export const Route = createFileRoute('/admin/crm/')({
  validateSearch: verifySearch,
  component: lazyRouteComponent(() => import('../../../pages/CrmProfileList.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
})