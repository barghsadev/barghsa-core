import { LayoutGridIcon, TableIcon } from 'lucide-react';
import { Button } from './button';

export type ListView = 'table' | 'card';

export function ListViewToggle({
  value,
  onChange,
  labels,
}: {
  value: ListView;
  onChange: (value: ListView) => void;
  labels: { group: string; table: string; card: string };
}) {
  return (
    <div role="group" aria-label={labels.group} className="flex flex-wrap gap-1">
      {(['table', 'card'] as const).map((view) => {
        const Icon = view === 'table' ? TableIcon : LayoutGridIcon;
        return (
          <Button
            key={view}
            type="button"
            variant={view === value ? 'secondary' : 'outline'}
            className="min-h-11"
            aria-pressed={view === value}
            onClick={() => onChange(view)}
          >
            <Icon aria-hidden="true" data-icon="inline-start" />
            {labels[view]}
          </Button>
        );
      })}
    </div>
  );
}
