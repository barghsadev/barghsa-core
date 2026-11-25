import { createFileRoute } from '@tanstack/react-router';
import { ConsultationDetailPage } from '../../pages/ConsultationDetailPage.js';

export const Route = createFileRoute('/_app/consultations/$requestId_/reply')({
  component: ConsultationReplyRoute,
});

function ConsultationReplyRoute() {
  const { requestId } = Route.useParams();
  return <ConsultationDetailPage requestId={requestId} view="reply" />;
}
