import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  ticketQueryOptions,
  customerTicketFilters,
  customerTicketsSearch,
} from '../../lib/support-list-query.js';

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
      search: (raw) => customerTicketFilters(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const queue = useListQuery(ticketQueryOptions, search, change);
  return <Tickets recordSearch={customerTicketFilters(search)} queries={{ queue }} />;
}
export const Route = createFileRoute('/_app/tickets/')({
  validateSearch: customerTicketsSearch,
  beforeLoad: ({ search }) => {
    if (search.ticketId)
      throw redirect({
        to: '/tickets/$ticketId',
        params: { ticketId: search.ticketId },
        search: customerTicketFilters(search),
        replace: true,
      });
  },
  component: TicketsRoute,
});
