import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/consultations')({
  validateSearch: (search: Record<string, unknown>) => ({
    assignment: search.assignment === 'unassigned' ? 'unassigned' : undefined,
  }),
  component: lazyRouteComponent(
    () => import('../../pages/AdminConsultationsPage.js'),
    'AdminConsultationsPage'
  ),
});
