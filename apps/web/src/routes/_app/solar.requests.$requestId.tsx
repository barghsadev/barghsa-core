import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
export const Route = createFileRoute('/_app/solar/requests/$requestId')({
  component: lazyRouteComponent(
    () => import('../../pages/SolarRequestDetailPage.js'),
    'SolarRequestDetailPage'
  ),
});
