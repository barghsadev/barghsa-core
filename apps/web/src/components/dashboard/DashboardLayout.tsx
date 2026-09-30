import type { ReactNode } from 'react';

/** Widget grid; the application shell remains in pages/DashboardLayout. */
export function DashboardLayout({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">{children}</div>;
}
