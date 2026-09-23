import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
export const Route = createFileRoute('/admin/solar-postal')({
  component: lazyRouteComponent(
    () => import('../../pages/AdminSolarPostalPage.js'),
    'AdminSolarPostalPage'
  ),
});
