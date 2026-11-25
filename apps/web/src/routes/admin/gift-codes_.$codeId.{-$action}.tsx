import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { giftCodeId, giftListSearch } from '../../lib/gift-list-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminGiftCodesPage.js'));

function GiftCodeRecordRoute() {
  const { codeId, action } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (
    (codeId !== 'new' && !giftCodeId(codeId)) ||
    (action && (action !== 'edit' || codeId === 'new'))
  )
    throw notFound();
  const goToRecord = (id: string, replace = false) =>
    void navigate({
      to: '/admin/gift-codes/$codeId/{-$action}',
      params: { codeId: id, action: undefined },
      search,
      replace,
    });
  const goToList = () => void navigate({ to: '/admin/gift-codes', search });
  return (
    <Page
      key={`${codeId}/${action ?? ''}`}
      workspace={
        codeId === 'new'
          ? { view: 'create', search, goToRecord, goToList }
          : { view: action ?? 'detail', codeId: giftCodeId(codeId), search, goToRecord, goToList }
      }
    />
  );
}

export const Route = createFileRoute('/admin/gift-codes_/$codeId/{-$action}')({
  validateSearch: giftListSearch,
  component: GiftCodeRecordRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
