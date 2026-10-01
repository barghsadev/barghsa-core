import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../../hooks/useListQuery.js';
import { crmSearch, crmQueryOptions } from '../../../lib/admin-list-query.js';

/**
 * CRM profile list route — index under /admin/crm.
 *
 * Owns validated filter, sort and cursor URL state. Dashboard verification
 * links remain supported, including after reload and history navigation.
 */
const Profiles = lazyRouteComponent(() => import('../../../pages/CrmProfileList.js'));
function CrmRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const query = useListQuery(
    crmQueryOptions,
    search,
    (change, options) =>
      void navigate({
        search: (current) => crmSearch(change(current)),
        replace: options?.replace ?? false,
        resetScroll: false,
      })
  );
  return <Profiles query={query} />;
}

export const Route = createFileRoute('/admin/crm/')({
  validateSearch: crmSearch,
  component: CrmRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
