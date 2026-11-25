import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import AdminAiSections from '../../components/AdminAiSections.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminAiModelsPage.js'));

function ModelRoute() {
  const { modelId, action } = Route.useParams();
  const navigate = Route.useNavigate();
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(modelId) ||
    (action && action !== 'edit' && action !== 'budget') ||
    (modelId === 'new' && action)
  )
    throw notFound();
  const showRecord = (id: string, replace = false) =>
    void navigate({
      to: '/admin/ai-models/$modelId/{-$action}',
      params: { modelId: id, action: undefined },
      replace,
    });
  const showList = () => void navigate({ to: '/admin/ai-models' });
  return (
    <AdminAiSections section="/admin/ai-models">
      <Page
        key={`${modelId}/${action ?? ''}`}
        workspace={
          modelId === 'new'
            ? { view: 'create', showRecord, showList }
            : { view: action ?? 'detail', modelId, showRecord, showList }
        }
      />
    </AdminAiSections>
  );
}

export const Route = createFileRoute('/admin/ai-models_/$modelId/{-$action}')({
  component: ModelRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
