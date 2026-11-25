import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  staffTicketFilters,
  staffTicketsSearch,
  ticketQueryOptions,
} from '../../lib/support-list-query.js';

const Tickets = lazyRouteComponent(() => import('../../pages/TicketsPage.js'), 'StaffTicketsPage');
function TicketsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const change = (
    update: (raw: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (raw) => staffTicketFilters(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const queue = useListQuery(ticketQueryOptions, search, change);
  return <Tickets queries={{ queue }} recordSearch={staffTicketFilters(search)} />;
}
export const Route = createFileRoute('/admin/tickets/')({
  validateSearch: staffTicketsSearch,
  beforeLoad: ({ search }) => {
    if (search.ticketId)
      throw redirect({
        to: '/admin/tickets/$ticketId/{-$section}',
        params: { ticketId: search.ticketId, section: undefined },
        search: staffTicketFilters(search),
        replace: true,
      });
  },
  component: TicketsRoute,
});
