import { createFileRoute } from '@tanstack/react-router';
import { SolarRequestDetailPage } from '../../pages/SolarRequestDetailPage.js';

export const Route = createFileRoute('/_app/solar/requests/$requestId')({
  component: SolarRequestDetailRoute,
});

function SolarRequestDetailRoute() {
  const { requestId } = Route.useParams();
  return <SolarRequestDetailPage requestId={requestId} />;
}
