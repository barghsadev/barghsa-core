import { createFileRoute } from '@tanstack/react-router'
import { InvoicesPage } from '../../../pages/InvoicesPage.js'
import { RouteSkeleton } from '../../../components/RouteSkeleton.js'
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js'

export const Route = createFileRoute('/_app/invoices/')({
  component: InvoicesPage,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
})
