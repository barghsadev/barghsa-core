import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { MaintenanceBoundary } from '../../components/MaintenanceNotice.js';

const SolarRequestForm = lazyRouteComponent(
  () => import('../../pages/SolarRequestPage.js'),
  'SolarRequestPage'
);
export const Route = createFileRoute('/_app/solar/requests/new')({
  validateSearch: (search: Record<string, unknown>) => ({ step: search.step }),
  component: () => (
    <MaintenanceBoundary capability="solar_requests">
      <SolarRequestForm />
    </MaintenanceBoundary>
  ),
});
