import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  electricityIncreaseQueryOptions,
  electricityIncreaseSearch,
} from '../../lib/electricity-change-query.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminElectricityIncreasesPage.js'));
function IncreasesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(electricityIncreaseQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => electricityIncreaseSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page queries={queries} />;
}

export const Route = createFileRoute('/admin/electricity-increases')({
  validateSearch: electricityIncreaseSearch,
  component: IncreasesRoute,
});
