import * as React from 'react';

import { cn } from '../../lib/utils';

function Label({
  className,
  htmlFor,
  children,
  required = false,
  optional,
  disabled = false,
  ...props
}: React.ComponentProps<'label'> & {
  required?: boolean;
  optional?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      data-slot="label"
      data-disabled={disabled || undefined}
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
      {...props}
    >
      {children}
      {required ? (
        <span aria-hidden="true" className="text-destructive">
          *
        </span>
      ) : null}
      {optional ? <span className="font-normal text-muted-foreground">{optional}</span> : null}
    </label>
  );
}

export { Label };
