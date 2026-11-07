import type { ComponentProps, CSSProperties } from 'react';
import { cn } from '../../lib/utils';

const breakpoints = ['base', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;
type ResponsiveNumber = number | Partial<Record<(typeof breakpoints)[number], number>>;
type DivProps = ComponentProps<'div'>;

// Set every value on the current layout so a nested layout never inherits
// the outer layout's breakpoint settings.
function values(name: string, value: ResponsiveNumber, initial: number): CSSProperties {
  let current = typeof value === 'number' ? value : initial;
  const style: Record<string, number> = {};
  for (const point of breakpoints) {
    if (typeof value !== 'number') current = value[point] ?? current;
    style[`--layout-${point}-${name}`] = current;
  }
  return style;
}

export function ResponsiveContainer({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="responsive-container"
      className={cn('responsive-container', className)}
      {...props}
    />
  );
}

type GapProps = DivProps & { gap?: ResponsiveNumber };

export function Stack({ gap = 4, className, style, ...props }: GapProps) {
  return (
    <div
      data-slot="stack"
      className={cn('layout-flow flex min-w-0 flex-col', className)}
      style={{ ...values('gap', gap, 4), ...style }}
      {...props}
    />
  );
}

export function Inline({ gap = 4, className, style, ...props }: GapProps) {
  return (
    <div
      data-slot="inline"
      className={cn('layout-flow flex min-w-0 flex-wrap items-center', className)}
      style={{ ...values('gap', gap, 4), ...style }}
      {...props}
    />
  );
}

export function Grid({
  columns = 1,
  gap = 4,
  className,
  style,
  ...props
}: GapProps & { columns?: ResponsiveNumber }) {
  return (
    <div
      data-slot="grid"
      className={cn('layout-flow grid min-w-0', className)}
      style={{
        ...values('cols', columns, 1),
        ...values('gap', gap, 4),
        ...style,
      }}
      {...props}
    />
  );
}
