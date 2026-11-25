import AdminAiSections from '../../components/AdminAiSections.js';
import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminAiModelsPage.js'));
export const Route = createFileRoute('/admin/ai-models')({
  validateSearch: (raw: Record<string, unknown>) => ({
    selected:
      typeof raw.selected === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(raw.selected)
        ? raw.selected
        : undefined,
    mode: raw.mode === 'budget' ? ('budget' as const) : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.selected)
      throw redirect({
        to: '/admin/ai-models/$modelId/{-$action}',
        params: { modelId: search.selected, action: search.mode ?? 'edit' },
        replace: true,
      });
  },
  component: () => (
    <AdminAiSections section="/admin/ai-models">
      <Page workspace={{ view: 'list' }} />
    </AdminAiSections>
  ),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
