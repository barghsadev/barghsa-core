'use client';

import * as React from 'react';
import { NumberField as NumberFieldPrimitive } from '@base-ui/react/number-field';

import { cn } from '../../lib/utils';
import { numberFieldLabels } from './number-field.labels';

const NumberFieldLocale = /* @__PURE__ */ React.createContext('fa-IR');
const isPersian = (locale: string) => /^fa(?:-|$)/i.test(locale);

function NumberField({
  className,
  format,
  locale,
  ...props
}: NumberFieldPrimitive.Root.Props & {
  format?: Intl.NumberFormatOptions;
  locale?: string;
}) {
  const resolvedLocale = locale ?? 'fa-IR';

  return (
    <NumberFieldLocale.Provider value={resolvedLocale}>
      <NumberFieldPrimitive.Root
        lang={resolvedLocale}
        dir={isPersian(resolvedLocale) ? 'rtl' : 'ltr'}
        data-slot="number-field"
        format={format}
        locale={resolvedLocale}
        className={cn('flex flex-col gap-1.5', className)}
        {...props}
      />
    </NumberFieldLocale.Provider>
  );
}

function NumberFieldGroup({ className, ...props }: NumberFieldPrimitive.Group.Props) {
  return (
    <NumberFieldPrimitive.Group
      data-slot="number-field-group"
      className={cn(
        'flex items-center rounded-lg border border-input bg-transparent has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50 has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:ring-3 has-[input[aria-invalid=true]]:ring-destructive/20 dark:bg-input/30',
        className
      )}
      {...props}
    />
  );
}

function NumberFieldInput({ className, ...props }: NumberFieldPrimitive.Input.Props) {
  return (
    <NumberFieldPrimitive.Input
      data-slot="number-field-input"
      className={cn(
        'flex h-9 w-full bg-transparent px-3 py-1.5 text-sm outline-hidden transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        className
      )}
      {...props}
    />
  );
}

function NumberFieldIncrement({ className, ...props }: NumberFieldPrimitive.Increment.Props) {
  const locale = React.useContext(NumberFieldLocale);
  return (
    <NumberFieldPrimitive.Increment
      aria-label={numberFieldLabels[isPersian(locale) ? 'fa' : 'en'].increase}
      data-slot="number-field-increment"
      className={cn(
        'flex h-9 min-w-9 items-center justify-center border-s border-input px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      <svg
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
      >
        <path d="M18 15l-6-6-6 6" />
      </svg>
    </NumberFieldPrimitive.Increment>
  );
}

function NumberFieldDecrement({ className, ...props }: NumberFieldPrimitive.Decrement.Props) {
  const locale = React.useContext(NumberFieldLocale);
  return (
    <NumberFieldPrimitive.Decrement
      aria-label={numberFieldLabels[isPersian(locale) ? 'fa' : 'en'].decrease}
      data-slot="number-field-decrement"
      className={cn(
        'flex h-9 min-w-9 items-center justify-center border-e border-input px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      <svg
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </NumberFieldPrimitive.Decrement>
  );
}

function NumberFieldScrubArea({ className, ...props }: NumberFieldPrimitive.ScrubArea.Props) {
  return (
    <NumberFieldPrimitive.ScrubArea
      data-slot="number-field-scrub"
      className={cn('cursor-ew-resize', className)}
      {...props}
    />
  );
}

export {
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
  NumberFieldIncrement,
  NumberFieldDecrement,
  NumberFieldScrubArea,
};
