import { workspaceMedia } from '@barghsa/i18n/workspace-media';
import { Link } from '@tanstack/react-router';
import { PageHeader, buttonVariants } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';

export default function ChartsPage() {
  const locale = useLocale();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <PageHeader
        title={workspaceMedia('charts', locale)}
        description={workspaceMedia('chartsDescription', locale)}
      />
      <Link
        to="/electricity"
        className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
      >
        {workspaceMedia('electricityServices', locale)}
      </Link>
    </div>
  );
}
