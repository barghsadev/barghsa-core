import { createFileRoute, notFound } from '@tanstack/react-router';
import { consultationDecision } from '../../lib/consultation-decision-route.js';

export const Route = createFileRoute('/admin/consultations/$requestId/decisions/$decision')({
  beforeLoad: ({ params }) => {
    if (!consultationDecision(params.decision)) throw notFound();
  },
  component: () => null,
});
