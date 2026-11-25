import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

const ConsultationIntakePage = lazyRouteComponent(
  () => import('../../pages/ConsultationsPage.js'),
  'ConsultationIntakePage'
);

export const Route = createFileRoute('/_app/consultations/new')({
  component: ConsultationIntakePage,
});
