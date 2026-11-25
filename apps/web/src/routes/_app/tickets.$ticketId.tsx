import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { customerTicketFilters } from '../../lib/support-list-query.js';
import { staffOrderId } from '../../lib/staff-order-list-query.js';

const Tickets = lazyRouteComponent(
  () => import('../../pages/TicketsPage.js'),
  'CustomerTicketsPage'
);

function TicketRoute() {
  const { ticketId } = Route.useParams();
  return (
    <Tickets key={ticketId} entry={{ kind: 'record', ticketId }} recordSearch={Route.useSearch()} />
  );
}

export const Route = createFileRoute('/_app/tickets/$ticketId')({
  validateSearch: customerTicketFilters,
  beforeLoad: ({ params }) => {
    if (!staffOrderId(params.ticketId)) throw notFound();
  },
  component: TicketRoute,
});
