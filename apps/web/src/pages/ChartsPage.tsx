import { workspaceMedia } from '@barghsa/i18n/workspace-media';
import { useLocale } from '../hooks/useLocale.js';

export default function ChartsPage() {
  const locale = useLocale();
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{workspaceMedia('charts', locale)}</h1>
      <p className="text-muted-foreground">{workspaceMedia('chartsDescription', locale)}</p>
    </div>
  );
}
