import { lazy, Suspense, type ReactNode } from 'react';
import { useNavigation } from '../hooks/useNavigation.js';
import { MaintenanceBoundary } from './MaintenanceNotice.js';

const ElectricityCompanyProfileNotice = lazy(() => import('./ElectricityCompanyProfileNotice.js'));

export function ElectricityCheckoutBoundary({ children }: { children: ReactNode }) {
  const navigation = useNavigation();
  if (navigation && navigation.profileType !== 'LEGAL')
    return (
      <Suspense fallback={null}>
        <ElectricityCompanyProfileNotice />
      </Suspense>
    );
  return <MaintenanceBoundary capability="electricity_checkout">{children}</MaintenanceBoundary>;
}
