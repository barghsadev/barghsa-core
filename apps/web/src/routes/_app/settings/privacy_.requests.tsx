import { createFileRoute, lazyRouteComponent, Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../../../hooks/useLocale.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';

const ProfileLifecyclePanel = lazyRouteComponent(
  () => import('../../../components/ProfileLifecyclePanel.js'),
  'ProfileLifecyclePanel'
);

function PrivacyRequestsPage() {
  const locale = useLocale();
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <Link to="/settings/privacy" className="text-sm font-medium text-primary hover:underline">
        {t('settings.privacy.title', locale)}
      </Link>
      <ProfileLifecyclePanel />
    </div>
  );
}

export const Route = createFileRoute('/_app/settings/privacy_/requests')({
  component: PrivacyRequestsPage,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
