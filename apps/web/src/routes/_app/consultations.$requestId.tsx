import { createFileRoute } from '@tanstack/react-router';
import { ConsultationDetailPage } from '../../pages/ConsultationDetailPage.js';

export const Route = createFileRoute('/_app/consultations/$requestId')({
  component: ConsultationDetailRoute,
});

function ConsultationDetailRoute() {
  const { requestId } = Route.useParams();
  return <ConsultationDetailPage requestId={requestId} />;
}
