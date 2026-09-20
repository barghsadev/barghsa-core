import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/crm/profiles/$profileId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/admin/crm/profiles/$profileId',
      params: { profileId: params.profileId },
      replace: true,
    });
  },
});
