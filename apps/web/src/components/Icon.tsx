import type { LucideIcon, LucideProps } from 'lucide-react';
import { cn } from '@barghsa/ui';
import { useDirection } from '../hooks/useDirection.js';

/** Physical diagrams can opt out; navigation arrows follow the live locale. */
export function Icon({
  icon: Glyph,
  flipInRtl = /(?:Left|Right)(?:Icon)?$|-(?:left|right)$/i.test(Glyph.displayName ?? ''),
  className,
  ...props
}: LucideProps & { icon: LucideIcon; flipInRtl?: boolean }) {
  const { isRtl } = useDirection();
  return (
    <Glyph
      aria-hidden={props['aria-label'] ? undefined : true}
      className={cn(className, isRtl && flipInRtl && '-scale-x-100')}
      {...props}
    />
  );
}
