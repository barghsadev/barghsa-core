import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';

const CustomerDashboard = lazy(() =>
  import('../../pages/DashboardPage.js').then(({ DashboardPage }) => ({ default: DashboardPage }))
);
const StaffDashboard = lazy(() => import('../../pages/AdminDashboard.js'));

function AppDashboard() {
  const { isStaff } = Route.useRouteContext();
  return (
    <Suspense fallback={<RouteSkeleton layout={isStaff ? 'admin' : 'default'} />}>
      {isStaff ? <StaffDashboard /> : <CustomerDashboard />}
    </Suspense>
  );
}

export const Route = createFileRoute('/_app/app')({
  component: AppDashboard,
});
