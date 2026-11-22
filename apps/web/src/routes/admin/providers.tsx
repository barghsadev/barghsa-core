import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useCallback } from 'react';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import type { ProviderChannel, ProviderSelection } from '../../lib/provider-workspace.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminDeliveryProvidersPage.js'));

function providerSearch(raw: Record<string, unknown>) {
  const channel: ProviderChannel | undefined = raw.channel === 'sms' ? 'sms' : undefined;
  const id =
    typeof raw.selected === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(raw.selected)
      ? raw.selected
      : undefined;
  const panel: ProviderSelection['panel'] | undefined =
    raw.panel === 'new'
      ? 'new'
      : id && channel === 'sms' && (raw.panel === 'clone' || raw.panel === 'preview')
        ? raw.panel
        : id && raw.panel === 'edit'
          ? 'edit'
          : undefined;
  return { channel, panel, selected: panel && panel !== 'new' ? id : undefined };
}

function ProvidersRoute() {
  const search = providerSearch(Route.useSearch());
  const navigate = Route.useNavigate();
  const set = useCallback(
    (selection: ProviderSelection | undefined, replace = false) => {
      void navigate({
        search: (raw) =>
          providerSearch({ ...raw, panel: selection?.panel, selected: selection?.id }),
        replace,
        resetScroll: false,
      });
    },
    [navigate]
  );
  return (
    <Page
      channel={search.channel ?? 'email'}
      setChannel={(channel) =>
        void navigate({ search: providerSearch({ channel }), resetScroll: false })
      }
      workspace={{
        selection:
          search.panel === 'new'
            ? { panel: 'new' }
            : search.panel && search.selected
              ? { panel: search.panel, id: search.selected }
              : undefined,
        set,
      }}
    />
  );
}

export const Route = createFileRoute('/admin/providers')({
  component: ProvidersRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
