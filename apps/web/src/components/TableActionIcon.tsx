import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Keep the action name available to assistive technology and to card layouts. */
export function TableActionIcon({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <>
      <Icon data-table-action-icon="" aria-hidden="true" />
      <span data-table-action-label="">{children}</span>
    </>
  );
}
