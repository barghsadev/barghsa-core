import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import { ticketQueryOptions, customerTicketsSearch } from '../../lib/support-list-query.js';

const Tickets = lazyRouteComponent(
  () => import('../../pages/TicketsPage.js'),
  'CustomerTicketsPage'
);
function TicketsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const change = (
    update: (raw: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (raw) => customerTicketsSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const queue = useListQuery(ticketQueryOptions, search, change);
  return (
    <Tickets
      queries={{
        queue,
        selected: search.ticketId ?? null,
        select: (id, replace = false) =>
          change((raw) => ({ ...raw, ticketId: id ?? undefined }), { replace }),
      }}
    />
  );
}
export const Route = createFileRoute('/_app/tickets')({
  validateSearch: customerTicketsSearch,
  component: TicketsRoute,
});
