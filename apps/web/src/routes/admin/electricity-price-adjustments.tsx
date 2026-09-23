import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/electricity-price-adjustments')({
  component: lazyRouteComponent(
    () => import('../../pages/AdminElectricityPriceAdjustmentsPage.js')
  ),
});
