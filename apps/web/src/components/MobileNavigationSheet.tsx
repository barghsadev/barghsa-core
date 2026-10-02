import { Link } from '@tanstack/react-router';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import type { NavigationGroup } from './AppShell.js';

export type MobileNavigationSheetProps = {
  open: boolean;
  locale: 'en' | 'fa';
  groups: NavigationGroup[];
  currentTo: string | undefined;
  onOpenChange: (open: boolean) => void;
};

export default function MobileNavigationSheet({
  open,
  locale,
  groups,
  currentTo,
  onOpenChange,
}: MobileNavigationSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={locale === 'fa' ? 'right' : 'left'}
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        closeLabel={shellText('close', locale)}
        className="w-full sm:max-w-md"
      >
        <SheetHeader className="border-b px-5 py-5 pe-14">
          <SheetTitle>{shellText('more', locale)}</SheetTitle>
          <SheetDescription>{shellText('moreDescription', locale)}</SheetDescription>
        </SheetHeader>
        <nav
          aria-label={shellText('moreNavigation', locale)}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"
        >
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-3 text-xs font-medium text-muted-foreground">{group.label}</p>
              <ul className="space-y-1">
                {group.items.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <Link
                      to={to}
                      activeOptions={{ exact: true }}
                      className="shell-navigation-link"
                      aria-current={currentTo === to ? 'page' : undefined}
                      onClick={() => onOpenChange(false)}
                    >
                      <Icon className="size-5 shrink-0" aria-hidden="true" />
                      <span>{label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
