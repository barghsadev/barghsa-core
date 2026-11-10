import { useEffect, type ReactNode } from 'react';
import { publicShellText } from '@barghsa/i18n/public-shell';
import { DirectionProvider } from '@barghsa/ui/direction-provider';
import { useDirection } from '../hooks/useDirection.js';

/** Keep portal layout and Base UI keyboard behavior aligned with the document locale. */
export function UiDirectionProvider({ children }: { children: ReactNode }) {
  const { dir: direction } = useDirection();
  useEffect(() => {
    document.documentElement.dir = direction;
  }, [direction]);
  return (
    <DirectionProvider
      direction={direction}
      focusGuardLabel={publicShellText('focusNavigation', direction === 'rtl' ? 'fa' : 'en')}
    >
      {children}
    </DirectionProvider>
  );
}
