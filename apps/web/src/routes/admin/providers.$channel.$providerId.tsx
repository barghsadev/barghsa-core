import { createFileRoute, notFound } from '@tanstack/react-router';
import { validProviderId } from '../../lib/provider-workspace.js';

export const Route = createFileRoute('/admin/providers/$channel/$providerId')({
  beforeLoad: ({ params }) => {
    if (!validProviderId(params.providerId)) throw notFound();
  },
});
