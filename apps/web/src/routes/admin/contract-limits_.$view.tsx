import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary, RouteNotFound } from '../../components/RouteErrorBoundary.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminContractLimitsPage.js'));
const History = lazyRouteComponent(() => import('../../pages/ContractLimitsHistoryPage.js'));

function SettingsView() {
  const { view } = Route.useParams();
  if (view === 'history') return <History />;
  if (view !== 'edit') return <RouteNotFound />;
  return <Page key={view} view={view} />;
}

export const Route = createFileRoute('/admin/contract-limits_/$view')({
  component: SettingsView,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
