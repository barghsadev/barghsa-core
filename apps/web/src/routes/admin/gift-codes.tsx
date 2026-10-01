import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import { giftQueryOptions, giftListSearch } from '../../lib/gift-list-query.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminGiftCodesPage.js'));
function GiftCodesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(giftQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => giftListSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return (
    <Page
      queries={queries}
      selection={{
        id: String(search.selected || ''),
        apply: (filters) => {
          void navigate({
            search: (raw) => giftListSearch({ ...raw, ...filters, selected: '', cursor: '' }),
            resetScroll: false,
          });
        },
        set: (id) => {
          void navigate({
            search: (raw) => giftListSearch({ ...raw, selected: id }),
            resetScroll: false,
          });
        },
      }}
    />
  );
}
export const Route = createFileRoute('/admin/gift-codes')({
  validateSearch: giftListSearch,
  component: GiftCodesRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
