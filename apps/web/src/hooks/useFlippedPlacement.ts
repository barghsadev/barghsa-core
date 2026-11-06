import { useDirection } from './useDirection.js';

type Placement = 'left' | 'right' | 'top' | 'bottom' | 'inline-start' | 'inline-end';

/** Logical placements already follow Base UI's direction context. */
export function useFlippedPlacement(placement: Placement): Placement {
  const { isRtl } = useDirection();
  if (!isRtl) return placement;
  return placement === 'left' ? 'right' : placement === 'right' ? 'left' : placement;
}
