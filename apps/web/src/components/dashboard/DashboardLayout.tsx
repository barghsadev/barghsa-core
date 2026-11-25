import { Grid } from '@barghsa/ui';
import type { ReactNode } from 'react';

/** Widget grid; the application shell remains in pages/DashboardLayout. */
export function DashboardLayout({
  children,
  tracks = 3,
}: {
  children: ReactNode;
  tracks?: 1 | 2 | 3;
}) {
  return (
    <Grid columns={{ base: 1, md: tracks === 1 ? 1 : 2, xl: tracks }} gap={tracks === 3 ? 5 : 4}>
      {children}
    </Grid>
  );
}
