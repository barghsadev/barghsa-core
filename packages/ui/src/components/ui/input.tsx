import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const inputVariants = cva(
  'w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base transition-shadow outline-none file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 read-only:bg-muted aria-invalid:border-destructive md:text-sm',
  {
    variants: {
      variant: { default: '', error: 'border-destructive', success: 'border-success' },
      controlSize: { xs: 'h-7', sm: 'h-9', default: 'h-11', lg: 'h-12', xl: 'h-14' },
    },
    defaultVariants: { variant: 'default', controlSize: 'default' },
  }
);

function Input({
  className,
  type,
  variant,
  controlSize,
  ...props
}: React.ComponentProps<'input'> & VariantProps<typeof inputVariants>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      aria-invalid={variant === 'error' || undefined}
      className={cn(inputVariants({ variant, controlSize }), className)}
      {...props}
    />
  );
}
export { Input };
