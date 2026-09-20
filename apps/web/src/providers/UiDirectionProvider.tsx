import { useEffect, type ReactNode } from 'react';
import { DirectionProvider } from '@barghsa/ui/direction-provider';
import { useDirection } from '../hooks/useDirection.js';

/** Keep portal layout and Base UI keyboard behavior aligned with the document locale. */
export function UiDirectionProvider({ children }: { children: ReactNode }) {
  const direction = useDirection();
  useEffect(() => {
    document.documentElement.dir = direction;
  }, [direction]);
  return <DirectionProvider direction={direction}>{children}</DirectionProvider>;
}
