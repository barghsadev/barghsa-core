import { useId, type ReactNode } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { cn } from '@barghsa/ui';

export const recordEditorSurface = 'min-w-0 overflow-hidden rounded-xl border bg-card';
export const recordEditorField = 'min-w-0 space-y-1';
export const recordEditorGrid = 'grid min-w-0 gap-x-5 gap-y-1.5 sm:grid-cols-2';
export const recordFilePicker =
  'flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed bg-muted/25 px-3 py-2.5';
export const recordFilePickerAction =
  'h-auto min-h-11 max-w-full gap-2 whitespace-normal border-border bg-card px-3 py-2';
export const recordFilePickerHelp =
  'min-w-0 grow basis-20 text-xs text-muted-foreground [overflow-wrap:anywhere]';

export function RecordEditorSection({
  title,
  description,
  children,
  anchorId,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  anchorId?: string;
}) {
  const generatedId = useId();
  const titleId = anchorId ?? generatedId;
  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 space-y-2.5 border-b px-4 py-4 last:border-b-0 sm:px-6"
    >
      <div className="space-y-1">
        <h2
          id={titleId}
          tabIndex={anchorId ? -1 : undefined}
          className="w-fit scroll-mt-4 rounded-sm text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function RecordEditorActions({
  children,
  secondary,
  className,
}: {
  children: ReactNode;
  secondary?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center justify-end gap-2 border-t bg-muted/35 px-4 py-3 sm:px-6',
        className
      )}
    >
      {secondary && <div className="me-auto">{secondary}</div>}
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function RecordEditorDisclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="group mx-4 my-2 min-w-0 sm:mx-6">
      <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm font-medium text-primary hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
        {label}
      </summary>
      <div className="pb-2 pt-1">{children}</div>
    </details>
  );
}
