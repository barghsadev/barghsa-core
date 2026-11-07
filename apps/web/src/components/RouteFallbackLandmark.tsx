import { createContext, useContext, type ReactNode } from 'react';

export const InsideRouteMain = createContext(false);

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
