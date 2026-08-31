import { createFileRoute } from '@tanstack/react-router'
import { InvoiceDetailsPage } from '../../../pages/InvoiceDetailsPage.js'
import { RouteSkeleton } from '../../../components/RouteSkeleton.js'
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js'

export const Route = createFileRoute('/_app/invoices/$invoiceId')({
  component: InvoiceDetailsRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
})

function InvoiceDetailsRoute() {
  const { invoiceId } = Route.useParams()
  return <InvoiceDetailsPage invoiceId={invoiceId} />
}
