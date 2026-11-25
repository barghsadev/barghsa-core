import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminVatPage.js'));

function VatRecordRoute() {
  const { kind, recordId, action } = Route.useParams();
  const navigate = Route.useNavigate();
  if (
    (kind !== 'rates' && kind !== 'overrides') ||
    !/^[a-z0-9_-]{1,128}$/i.test(recordId) ||
    (action && (action !== 'end' || recordId === 'new'))
  )
    throw notFound();
  const showRecord = (id: string, replace = false) =>
    void navigate({
      to: '/admin/vat/$kind/$recordId/{-$action}',
      params: { kind, recordId: id, action: undefined },
      replace,
    });
  const showList = () => void navigate({ to: '/admin/vat' });
  return (
    <Page
      key={`${kind}/${recordId}/${action ?? ''}`}
      workspace={
        recordId === 'new'
          ? { view: 'create', kind, showRecord, showList }
          : { view: action ?? 'detail', kind, recordId, showRecord, showList }
      }
    />
  );
}

export const Route = createFileRoute('/admin/vat_/$kind/$recordId/{-$action}')({
  component: VatRecordRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
