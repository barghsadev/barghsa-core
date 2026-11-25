import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { pendingReceiptSearch } from '../../lib/finance-list-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminFinancialLimitPage.js'));

function SettingsRoute() {
  const { view } = Route.useParams();
  return <Page key={view} kind="wallet" viewParam={view} search={Route.useSearch()} />;
}

export const Route = createFileRoute('/admin/wallet-receipts/settings/{-$view}')({
  validateSearch: pendingReceiptSearch,
  component: SettingsRoute,
  pendingComponent: StaffRecordLoading,
});
