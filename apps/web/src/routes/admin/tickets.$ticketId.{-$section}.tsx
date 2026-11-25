import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { staffOrderId } from '../../lib/staff-order-list-query.js';
import { staffTicketFilters } from '../../lib/support-list-query.js';

const Tickets = lazyRouteComponent(() => import('../../pages/TicketsPage.js'), 'StaffTicketsPage');

function StaffTicketRoute() {
  const { ticketId, section } = Route.useParams();
  return (
    <Tickets
      key={ticketId}
      entry={{ kind: 'record', ticketId, closure: section === 'closure' }}
      recordSearch={Route.useSearch()}
    />
  );
}

export const Route = createFileRoute('/admin/tickets/$ticketId/{-$section}')({
  validateSearch: staffTicketFilters,
  beforeLoad: ({ params }) => {
    if (!staffOrderId(params.ticketId) || (params.section && params.section !== 'closure'))
      throw notFound();
  },
  component: StaffTicketRoute,
});
