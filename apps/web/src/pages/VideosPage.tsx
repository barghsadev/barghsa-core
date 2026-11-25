import { workspaceMedia } from '@barghsa/i18n/workspace-media';
import { Link } from '@tanstack/react-router';
import { PageHeader, buttonVariants } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';

export default function VideosPage() {
  const locale = useLocale();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <PageHeader
        title={workspaceMedia('videos', locale)}
        description={workspaceMedia('videosDescription', locale)}
      />
      <Link
        to="/solar/requests"
        className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
      >
        {workspaceMedia('solarRequests', locale)}
      </Link>
    </div>
  );
}
