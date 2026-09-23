import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
export const Route = createFileRoute('/admin/solar-requests')({
  component: lazyRouteComponent(
    () => import('../../pages/AdminSolarDocumentsPage.js'),
    'AdminSolarDocumentsPage'
  ),
});
