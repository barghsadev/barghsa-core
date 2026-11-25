import { createFileRoute, notFound } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/providers/$channel/$providerId/test')({
  beforeLoad: ({ context }) => {
    if (context.channel !== 'sms') throw notFound();
  },
});
