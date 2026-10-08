import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';
import { XIcon } from 'lucide-react';
import { Button } from './button';

const alertVariants = cva('group/alert alert-layout', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      success:
        'border-success/20 bg-success-soft text-success *:data-[slot=alert-description]:text-success',
      warning:
        'border-warning/20 bg-warning-soft text-warning *:data-[slot=alert-description]:text-warning',
      info: 'border-info/20 bg-info-soft text-info *:data-[slot=alert-description]:text-info',
      destructive:
        'border-destructive/20 bg-danger-soft text-destructive *:data-[slot=alert-description]:text-destructive',
      error:
        'border-destructive/20 bg-danger-soft text-destructive *:data-[slot=alert-description]:text-destructive',
      critical:
        'border-destructive/20 bg-danger-soft text-destructive *:data-[slot=alert-description]:text-destructive alert-critical',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        'font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
        className
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4',
        className
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-action"
      className={cn(
        'absolute top-2 end-2 group-has-data-[slot=alert-dismiss]/alert:static group-has-data-[slot=alert-dismiss]/alert:mt-2 group-has-data-[slot=alert-dismiss]/alert:col-span-full',
        className
      )}
      {...props}
    />
  );
}

function AlertDismiss({
  dismissLabel,
  onDismiss,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'children' | 'aria-label' | 'onClick' | 'type'> & {
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <Button
      {...props}
      data-slot="alert-dismiss"
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn('absolute top-2 end-2 text-current', className)}
      aria-label={dismissLabel}
      onClick={onDismiss}
    >
      <XIcon aria-hidden="true" />
    </Button>
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction, AlertDismiss };
