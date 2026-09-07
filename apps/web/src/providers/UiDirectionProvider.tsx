import { useEffect, type ReactNode } from 'react';
import { DirectionProvider } from '@barghsa/ui/direction-provider';
import { useLocale } from '../hooks/useLocale.js';

/** Keep portal layout and Base UI keyboard behavior aligned with the document locale. */
export function UiDirectionProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const direction = locale === 'fa' ? 'rtl' : 'ltr';
  useEffect(() => {
    document.documentElement.dir = direction;
  }, [direction]);
  return <DirectionProvider direction={direction}>{children}</DirectionProvider>;
}
