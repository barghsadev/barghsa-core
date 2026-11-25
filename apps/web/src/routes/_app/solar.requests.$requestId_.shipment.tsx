import { createFileRoute, useMatchRoute } from '@tanstack/react-router';
import { SolarRequestDetailPage } from '../../pages/SolarRequestDetailPage.js';

export const Route = createFileRoute('/_app/solar/requests/$requestId_/shipment')({
  component: SolarShipmentRoute,
});

function SolarShipmentRoute() {
  const { requestId } = Route.useParams();
  const match = useMatchRoute();
  return (
    <SolarRequestDetailPage
      requestId={requestId}
      view="shipment"
      receiptEditor={
        !!match({ to: '/solar/requests/$requestId/shipment/upload-receipt', params: { requestId } })
      }
    />
  );
}
