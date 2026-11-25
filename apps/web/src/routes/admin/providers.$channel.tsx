import { createFileRoute, lazyRouteComponent, notFound, useMatches } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { providerDestination, type ProviderSelection } from '../../lib/provider-workspace.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminDeliveryProvidersPage.js'));

function ProvidersChannel() {
  const { channel } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  const selection = useMatches({
    select: (matches): ProviderSelection | undefined => {
      const match = matches.at(-1);
      if (match?.routeId === '/admin/providers/$channel/new') return { panel: 'new' };
      if (match && 'providerId' in match.params) {
        const id = match.params.providerId;
        if (match.routeId === '/admin/providers/$channel/$providerId/edit')
          return { panel: 'edit', id };
        if (match.routeId === '/admin/providers/$channel/$providerId/duplicate')
          return { panel: 'clone', id };
        if (match.routeId === '/admin/providers/$channel/$providerId/test')
          return { panel: 'preview', id };
        if (match.routeId === '/admin/providers/$channel/$providerId')
          return { panel: 'detail', id };
      }
      return undefined;
    },
  });
  return (
    <Page
      channel={channel}
      setChannel={(next) => void navigate(providerDestination(next))}
      workspace={{
        selection,
        set: (next, replace = false) =>
          void navigate({ ...providerDestination(channel, next), replace }),
      }}
    />
  );
}

export const Route = createFileRoute('/admin/providers/$channel')({
  beforeLoad: ({ params }) => {
    const { channel } = params;
    if (channel !== 'sms' && channel !== 'email') throw notFound();
    return { channel };
  },
  component: ProvidersChannel,
  pendingComponent: StaffRecordLoading,
});
