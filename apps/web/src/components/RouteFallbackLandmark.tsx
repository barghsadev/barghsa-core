import { createContext, useContext, type ReactNode } from 'react';
import { feedbackText } from '@barghsa/i18n/feedback';
import { reloadText } from '@barghsa/i18n/loading-feedback';
import { useLocale } from '../hooks/useLocale.js';

export const InsideRouteMain = createContext(false);
const routeReloadText = import.meta.env.PROD && __BARGHSA_AUTH_ENTRY__ ? reloadText : feedbackText;

/** A child fallback inherits its shell's landmark; a standalone fallback owns it. */
export function RouteFallbackLandmark({ children }: { children: ReactNode }) {
  return useContext(InsideRouteMain) ? (
    children
  ) : (
    <main id="main-content" tabIndex={-1}>
      {children}
    </main>
  );
}

/** This recovery action is available even when the lazy error UI cannot load. */
export function RouteEmergencyReload() {
  const locale = useLocale();
  return (
    <RouteFallbackLandmark>
      <section role="alert" className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="text-2xl font-semibold">{routeReloadText('chunkTitle', locale)}</h1>
        <button type="button" className="touch-action underline" onClick={() => location.reload()}>
          {routeReloadText('reload', locale)}
        </button>
      </section>
    </RouteFallbackLandmark>
  );
}
