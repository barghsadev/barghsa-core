import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { electricityPriceSearch } from '../../lib/electricity-change-query.js';

const Page = lazyRouteComponent(
  () => import('../../pages/AdminElectricityPriceAdjustmentsPage.js')
);

function PriceLookupRoute() {
  const navigate = Route.useNavigate();
  return (
    <Page
      onOpenContract={(contractId) =>
        void navigate({
          to: '/admin/electricity-price-adjustments/$contractId',
          params: { contractId },
        })
      }
    />
  );
}

export const Route = createFileRoute('/admin/electricity-price-adjustments/')({
  validateSearch: electricityPriceSearch,
  beforeLoad: ({ search }) => {
    if (typeof search.contractId === 'string')
      throw redirect({
        to: '/admin/electricity-price-adjustments/$contractId',
        params: { contractId: search.contractId.toLowerCase() },
        replace: true,
      });
  },
  component: PriceLookupRoute,
});
