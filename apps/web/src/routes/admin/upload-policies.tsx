import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useCallback } from 'react';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminUploadPoliciesPage.js'));
const categories = ['document', 'image', 'video'];

function policyAddress(raw: Record<string, unknown>) {
  const selected =
    typeof raw.selected === 'string' && categories.includes(raw.selected)
      ? raw.selected
      : undefined;
  const requestedHistory = typeof raw.history === 'string' ? raw.history.split(',') : [];
  return {
    selected,
    history:
      categories.filter((category) => requestedHistory.includes(category)).join(',') || undefined,
  };
}

function UploadPolicyRoute() {
  const search = policyAddress(Route.useSearch());
  const navigate = Route.useNavigate();
  const set = useCallback(
    (id: string | null, replace = false) => {
      void navigate({
        search: (raw) => policyAddress({ ...raw, selected: id }),
        replace,
        resetScroll: false,
      });
    },
    [navigate]
  );
  const clear = useCallback(
    () => void navigate({ search: {}, replace: true, resetScroll: false }),
    [navigate]
  );
  return (
    <Page
      workspace={{
        editor: { id: search.selected ?? null, set },
        clear,
        history: search.history?.split(',') ?? [],
        toggleHistory: (category) =>
          void navigate({
            resetScroll: false,
            search: (raw) => {
              const address = policyAddress(raw);
              const values = address.history?.split(',') ?? [];
              const history = values.includes(category)
                ? values.filter((value) => value !== category)
                : [...values, category];
              return policyAddress({ ...address, history: history.join(',') });
            },
          }),
      }}
    />
  );
}
export const Route = createFileRoute('/admin/upload-policies')({
  component: UploadPolicyRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
