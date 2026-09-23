import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/electricity-increases')({
  component: lazyRouteComponent(() => import('../../pages/AdminElectricityIncreasesPage.js')),
});
