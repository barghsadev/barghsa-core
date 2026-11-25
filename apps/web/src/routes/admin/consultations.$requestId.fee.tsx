import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/consultations/$requestId/fee')({
  component: () => null,
});
