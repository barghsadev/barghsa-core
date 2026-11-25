import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import {
  customerTicketFilters,
  newTicketSearch,
  ticketRelatedRecord,
} from '../../lib/support-list-query.js';

const Tickets = lazyRouteComponent(
  () => import('../../pages/TicketsPage.js'),
  'CustomerTicketsPage'
);

function NewTicketRoute() {
  const search = Route.useSearch();
  const filters = customerTicketFilters(search);
  const related = ticketRelatedRecord(search);
  const navigate = Route.useNavigate();
  return (
    <Tickets
      key={related && related.relatedType + ':' + related.relatedId}
      recordSearch={filters}
      entry={{
        kind: 'new',
        ...(related ? { related } : {}),
        onCreated: (ticketId) =>
          navigate({
            to: '/tickets/$ticketId',
            params: { ticketId },
            search: filters,
            replace: true,
          }),
      }}
    />
  );
}

export const Route = createFileRoute('/_app/tickets/new')({
  validateSearch: newTicketSearch,
  component: NewTicketRoute,
});
