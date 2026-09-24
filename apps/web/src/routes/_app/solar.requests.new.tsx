import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { MaintenanceBoundary } from '../../components/MaintenanceNotice.js';

const SolarRequestForm = lazyRouteComponent(
  () => import('../../pages/SolarRequestPage.js'),
  'SolarRequestPage'
);
export const Route = createFileRoute('/_app/solar/requests/new')({
  component: () => (
    <MaintenanceBoundary capability="solar_requests">
      <SolarRequestForm />
    </MaintenanceBoundary>
  ),
});
