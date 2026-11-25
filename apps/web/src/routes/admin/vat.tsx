import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminVatPage.js'));

export const Route = createFileRoute('/admin/vat')({
  beforeLoad: ({ search }: { search: Record<string, unknown> }) => {
    const { mode, selected } = search;
    if (mode === 'rate' || mode === 'override')
      throw redirect({
        to: '/admin/vat/$kind/$recordId/{-$action}',
        params: {
          kind: mode === 'rate' ? 'rates' : 'overrides',
          recordId: 'new',
          action: undefined,
        },
        replace: true,
      });
    if (
      (mode === 'endRate' || mode === 'endOverride') &&
      typeof selected === 'string' &&
      /^[a-z0-9_-]{1,128}$/i.test(selected)
    )
      throw redirect({
        to: '/admin/vat/$kind/$recordId/{-$action}',
        params: {
          kind: mode === 'endRate' ? 'rates' : 'overrides',
          recordId: selected,
          action: 'end',
        },
        replace: true,
      });
  },
  component: () => <Page workspace={{ view: 'list' }} />,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
