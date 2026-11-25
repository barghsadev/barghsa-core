import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { UPLOAD_POLICY_CATEGORIES, isUploadPolicyCategory } from '@barghsa/shared/admin';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminUploadPoliciesPage.js'));

export const Route = createFileRoute('/admin/upload-policies')({
  validateSearch: (raw: Record<string, unknown>) => {
    const value = typeof raw.selected === 'string' ? raw.selected : '';
    const history = typeof raw.history === 'string' ? raw.history.split(',') : [];
    return {
      selected: isUploadPolicyCategory(value) ? value : undefined,
      history: UPLOAD_POLICY_CATEGORIES.find((category) => history.includes(category)),
    };
  },
  beforeLoad: ({ search }) => {
    const category = search.selected ?? search.history;
    if (category)
      throw redirect({
        to: '/admin/upload-policies/$category/{-$action}',
        params: { category, action: search.selected ? 'edit' : 'history' },
        replace: true,
      });
  },
  component: () => <Page workspace={{ view: 'catalogue' }} />,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
