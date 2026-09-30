import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDownIcon, SlidersHorizontalIcon } from 'lucide-react';
import { Badge } from './badge';
import { Button } from './button';

/** Keep filter drafts mounted when collapsed; discard them when clearing all. */
export function ListFilterPanel({
  activeCount,
  countLabel,
  labels,
  onClear,
  children,
}: {
  activeCount: number;
  countLabel: string;
  labels: { filters: string; clear: string; activeCount: string };
  onClear: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const filterButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  const [reset, setReset] = useState(0);
  return (
    <div data-slot="list-filter-panel" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={filterButton}
          type="button"
          variant="outline"
          aria-label={labels.filters}
          aria-expanded={open}
          aria-controls={id}
          aria-describedby={activeCount ? `${id}-count` : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          <SlidersHorizontalIcon aria-hidden="true" data-icon="inline-start" />
          {labels.filters}
          {activeCount > 0 && <Badge aria-hidden="true">{countLabel}</Badge>}
          <ChevronDownIcon
            aria-hidden="true"
            data-icon="inline-end"
            className={open ? 'rotate-180' : undefined}
          />
        </Button>
        {activeCount > 0 && (
          <>
            <span id={`${id}-count`} className="sr-only">
              {labels.activeCount}
            </span>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                filterButton.current?.focus();
                setReset((value) => value + 1);
                onClear();
              }}
            >
              {labels.clear}
            </Button>
          </>
        )}
      </div>
      <div key={reset} id={id} hidden={!open} className="space-y-3">
        {children}
      </div>
    </div>
  );
}
