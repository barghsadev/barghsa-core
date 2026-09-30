import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/savings/')({
  component: lazyRouteComponent(() => import('../../pages/SavingsPage.js'), 'SavingsPage'),
});
