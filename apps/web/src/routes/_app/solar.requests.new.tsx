import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
export const Route = createFileRoute('/_app/solar/requests/new')({
  component: lazyRouteComponent(
    () => import('../../pages/SolarRequestPage.js'),
    'SolarRequestPage'
  ),
});
