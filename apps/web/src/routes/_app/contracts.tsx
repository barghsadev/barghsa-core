import { createFileRoute } from '@tanstack/react-router';
import ContractsPage from '../../pages/ContractsPage.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
function ContractsRoute() {
  const { state } = Route.useSearch();
  return <ContractsPage key={state ?? 'all'} activeOnly={state === 'Active'} />;
}

export const Route = createFileRoute('/_app/contracts')({
  validateSearch: (search: Record<string, unknown>) => ({
    state: search.state === 'Active' ? ('Active' as const) : undefined,
    contractId:
      typeof search.contractId === 'string' &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(search.contractId)
        ? search.contractId
        : undefined,
  }),
  component: ContractsRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
