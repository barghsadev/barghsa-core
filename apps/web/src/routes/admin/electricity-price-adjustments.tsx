import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  electricityPriceQueryOptions,
  electricityPriceSearch,
} from '../../lib/electricity-change-query.js';
const Page = lazyRouteComponent(
  () => import('../../pages/AdminElectricityPriceAdjustmentsPage.js')
);
function PriceRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(electricityPriceQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => electricityPriceSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page queries={queries} />;
}

export const Route = createFileRoute('/admin/electricity-price-adjustments')({
  validateSearch: electricityPriceSearch,
  component: PriceRoute,
});
