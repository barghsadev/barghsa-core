import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDownIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { Badge } from './badge';
import { Button } from './button';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from './sheet';
import { FilterApplyContext, type PrepareFilter } from './filter-apply-context';

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
  drawer,
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
  drawer?:
    | {
        resetKey?: string;
        onOpen: () => void;
        onApply: () => void;
        dir: 'rtl' | 'ltr';
        labels: { apply: string; cancel: string; close: string; description: string };
      }
    | undefined;
}) {
  const id = useId();
  const filterButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(!drawer);
  const [reset, setReset] = useState(0);
  const fields = useRef(new Map<string, PrepareFilter>());
  const form = useRef<HTMLFormElement>(null);
  const register = useCallback((key: string, prepare: PrepareFilter) => {
    fields.current.set(key, prepare);
    return () => {
      fields.current.delete(key);
    };
  }, []);
  const clear = () => {
    filterButton.current?.focus();
    setReset((value) => value + 1);
    onClear();
    if (drawer) setOpen(false);
  };
  const trigger = (
    <Button
      ref={filterButton}
      type="button"
      variant="outline"
      aria-label={labels.filters}
      aria-expanded={open}
      aria-controls={id}
      aria-describedby={activeCount ? `${id}-count` : undefined}
      onClick={drawer ? undefined : () => setOpen((value) => !value)}
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
  );
  const panel = (
    <div data-slot="list-filter-panel" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {drawer ? <SheetTrigger render={trigger} /> : trigger}
        {activeCount > 0 && (
          <>
            <span id={`${id}-count`} className="sr-only">
              {labels.activeCount}
            </span>
            <Button type="button" variant="ghost" onClick={clear}>
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
      {!drawer && (
        <div key={reset} id={id} hidden={!open} className="space-y-3">
          {children}
        </div>
      )}
    </div>
  );
  if (!drawer) return panel;
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (value) {
          drawer.onOpen();
          setReset((previous) => previous + 1);
        }
        setOpen(value);
      }}
    >
      {panel}
      <SheetContent
        id={id}
        side={drawer.dir === 'rtl' ? 'left' : 'right'}
        dir={drawer.dir}
        showCloseButton={false}
        className="gap-0 data-[side=left]:w-full data-[side=right]:w-full data-[side=left]:sm:max-w-xl data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="relative shrink-0 border-b pe-16">
          <SheetClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute end-3 top-3"
                aria-label={drawer.labels.close}
              />
            }
          >
            <XIcon aria-hidden="true" />
          </SheetClose>
          <SheetTitle>{labels.filters}</SheetTitle>
          <SheetDescription>{drawer.labels.description}</SheetDescription>
        </SheetHeader>
        <FilterApplyContext.Provider value={register}>
          <form
            ref={form}
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              const commits = [...fields.current.values()].map((prepare) => prepare());
              if (commits.some((commit) => !commit)) {
                form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
                return;
              }
              for (const commit of commits) commit?.();
              drawer.onApply();
              setOpen(false);
            }}
          >
            <div
              key={`${reset}:${drawer.resetKey ?? ''}`}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
            >
              {children}
            </div>
            <SheetFooter className="shrink-0 border-t sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={clear}>
                {labels.clear}
              </Button>
              <SheetClose render={<Button type="button" variant="outline" />}>
                {drawer.labels.cancel}
              </SheetClose>
              <Button type="submit">{drawer.labels.apply}</Button>
            </SheetFooter>
          </form>
        </FilterApplyContext.Provider>
      </SheetContent>
    </Sheet>
  );
}
