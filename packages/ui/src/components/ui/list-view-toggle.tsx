import { LayoutGridIcon, TableIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

export type ListView = 'table' | 'card';

export function ListViewToggle({
  value,
  onChange,
  labels,
  compact = false,
}: {
  value: ListView;
  onChange: (value: ListView) => void;
  labels: { group: string; table: string; card: string };
  compact?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={labels.group}
      className={cn('flex gap-1', compact ? 'rounded-lg bg-muted' : 'flex-wrap')}
    >
      {(['table', 'card'] as const).map((view) => {
        const Icon = view === 'table' ? TableIcon : LayoutGridIcon;
        return (
          <Button
            key={view}
            type="button"
            variant={compact ? 'ghost' : view === value ? 'secondary' : 'outline'}
            size={compact ? 'icon' : 'default'}
            className={cn(
              'min-h-11',
              compact &&
                'aria-pressed:border-primary/20 aria-pressed:bg-card aria-pressed:text-primary'
            )}
            title={compact ? labels[view] : undefined}
            aria-pressed={view === value}
            onClick={() => onChange(view)}
          >
            <Icon aria-hidden="true" data-icon={compact ? undefined : 'inline-start'} />
            {compact ? <span className="sr-only">{labels[view]}</span> : labels[view]}
          </Button>
        );
      })}
    </div>
  );
}
