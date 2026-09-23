import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
export const Route = createFileRoute('/_app/solar/requests')({
  component: lazyRouteComponent(
    () => import('../../pages/SolarRequestsPage.js'),
    'SolarRequestsPage'
  ),
});
