import { Grid } from '@barghsa/ui';
import type { ReactNode } from 'react';

/** Widget grid; the application shell remains in pages/DashboardLayout. */
export function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Grid columns={{ base: 1, md: 2, xl: 3 }} gap={5}>
      {children}
    </Grid>
  );
}
