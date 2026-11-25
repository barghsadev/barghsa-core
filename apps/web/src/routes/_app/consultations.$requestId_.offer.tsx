import { createFileRoute } from '@tanstack/react-router';
import { ConsultationDetailPage } from '../../pages/ConsultationDetailPage.js';

export const Route = createFileRoute('/_app/consultations/$requestId_/offer')({
  component: ConsultationOfferRoute,
});

function ConsultationOfferRoute() {
  const { requestId } = Route.useParams();
  return <ConsultationDetailPage requestId={requestId} view="offer" />;
}
