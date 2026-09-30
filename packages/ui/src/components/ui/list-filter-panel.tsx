import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDownIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { Badge } from './badge';
import { Button } from './button';

export interface ListFilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

/** Keep filter drafts mounted when collapsed; discard them when clearing all. */
export function ListFilterPanel({
  activeCount,
  countLabel,
  labels,
  onClear,
  chips = [],
  children,
}: {
  activeCount: number;
  countLabel: string;
  labels: {
    filters: string;
    clear: string;
    activeCount: string;
    selected: string;
    remove: string;
  };
  onClear: () => void;
  chips?: readonly ListFilterChip[];
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
      {chips.length > 0 && (
        <ul aria-label={labels.selected} className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li key={chip.id} className="max-w-full">
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-start"
                aria-label={labels.remove.replace('{filter}', chip.label)}
                onClick={() => {
                  filterButton.current?.focus();
                  chip.onRemove();
                }}
              >
                <span className="min-w-0 break-words">
                  <bdi>{chip.label}</bdi>
                </span>
                <XIcon aria-hidden="true" data-icon="inline-end" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div key={reset} id={id} hidden={!open} className="space-y-3">
        {children}
      </div>
    </div>
  );
}
