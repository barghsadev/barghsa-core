import { createFileRoute, notFound } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/providers/$channel/$providerId/duplicate')({
  beforeLoad: ({ context }) => {
    if (context.channel !== 'sms') throw notFound();
  },
});
