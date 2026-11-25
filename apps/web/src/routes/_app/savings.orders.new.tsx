import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { MaintenanceBoundary } from '../../components/MaintenanceNotice.js';

const SavingOrderForm = lazyRouteComponent(
  () => import('../../pages/SavingsOrderPage.js'),
  'SavingsOrderPage'
);

function SavingsOrderRoute() {
  const { plan } = Route.useSearch();
  return (
    <MaintenanceBoundary capability="saving_orders">
      <SavingOrderForm {...(plan ? { preferredPlanId: plan } : {})} />
    </MaintenanceBoundary>
  );
}

export const Route = createFileRoute('/_app/savings/orders/new')({
  validateSearch: (search: Record<string, unknown>): { step?: unknown; plan?: string } => {
    const plan =
      typeof search.plan === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(search.plan)
        ? search.plan
        : undefined;
    return plan ? { step: search.step ?? 1, plan } : { step: search.step };
  },
  component: SavingsOrderRoute,
});
