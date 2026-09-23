import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/consultations')({
  component: lazyRouteComponent(
    () => import('../../pages/AdminConsultationsPage.js'),
    'AdminConsultationsPage'
  ),
});
