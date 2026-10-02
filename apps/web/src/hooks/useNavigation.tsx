import { createContext, useContext, type ReactNode } from 'react';
import { useProfileContextRevision } from '../lib/profile-context.js';
import type { NavigationConfiguration } from '../lib/navigation-config.js';

const NavigationContext = createContext<{
  configuration: NavigationConfiguration | null;
  revision: number;
}>({ configuration: null, revision: -1 });

export function NavigationProvider({
  configuration,
  revision,
  children,
}: {
  configuration: NavigationConfiguration | null;
  revision: number;
  children: ReactNode;
}) {
  return (
    <NavigationContext.Provider value={{ configuration, revision }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const value = useContext(NavigationContext);
  const revision = useProfileContextRevision();
  return value.revision === revision ? value.configuration : null;
}
