import type { ReactNode } from 'react';
import { useDirection } from '../hooks/useDirection.js';

/** Choose directional content from the same live locale as the application shell. */
export function DirectionAware({ rtl, ltr }: { rtl: ReactNode; ltr: ReactNode }) {
  return useDirection().isRtl ? rtl : ltr;
}
