import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'
export const Route = createFileRoute('/_app/tickets')({
  validateSearch: (search: Record<string,unknown>) => ({ ticketId: typeof search.ticketId === 'string' && /^[a-f0-9-]{36}$/i.test(search.ticketId) ? search.ticketId : undefined }),
  component: lazyRouteComponent(() => import('../../pages/TicketsPage.js'), 'CustomerTicketsPage'),
})
