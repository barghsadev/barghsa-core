import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/consultations/$requestId')({
  component: lazyRouteComponent(
    () => import('../../pages/ConsultationDetailPage.js'),
    'ConsultationDetailPage'
  ),
});
