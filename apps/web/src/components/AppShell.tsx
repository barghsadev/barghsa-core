import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { Button, cn } from '@barghsa/ui';
import { Menu, X, ChevronRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { shellText } from '@barghsa/i18n/shell';
import { BrandMark } from './BrandMark.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';

export interface NavigationGroup {
  label: string;
  items: { to: string; label: string; icon: LucideIcon }[];
}

/** Shared frame only. Callers own real routes, permissions and profile context. */
export function AppShell({
  area,
  locale,
  groups,
  children,
  banners,
  profile,
  actions,
}: {
  area: 'dashboard' | 'admin';
  locale: 'fa' | 'en';
  groups: NavigationGroup[];
  children: ReactNode;
  banners?: ReactNode;
  profile?: ReactNode;
  actions?: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);
  const current = groups
    .flatMap((group) => group.items)
    .filter(
      (item) => pathname === item.to || (item.to !== '/admin' && pathname.startsWith(item.to + '/'))
    )
    .sort((a, b) => b.to.length - a.to.length)[0];
  const title = shellText(area === 'admin' ? 'administration' : 'workspace', locale);
  return (
    <div
      className="flex h-dvh flex-col bg-background text-foreground"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <a href={`#${area}-content`} className="sr-only focus:not-sr-only focus:bg-card focus:p-3">
        {shellText('skip', locale)}
      </a>
      {banners}
      <header className="flex min-h-(--topbar-height) shrink-0 items-center gap-3 border-b bg-card px-4 md:px-6">
        <Link
          to={area === 'admin' ? '/admin' : '/dashboard'}
          className="flex min-w-0 items-center text-foreground no-underline md:w-[calc(var(--sidebar-width)-3rem)]"
        >
          <BrandMark />
        </Link>
        <div className="hidden min-w-0 flex-1 items-center gap-2 text-sm md:flex">
          <span className="shrink-0 text-muted-foreground">{title}</span>
          {current ? (
            <>
              <ChevronRight
                className="size-3.5 shrink-0 text-muted-foreground rtl:rotate-180"
                aria-hidden="true"
              />
              <span className="truncate font-medium">{current.label}</span>
            </>
          ) : null}
        </div>
        <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <LanguageSwitcher />
          {actions}
          <Button
            ref={menuButton}
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={shellText('menu', locale)}
            aria-expanded={menuOpen}
            aria-controls={`${area}-navigation`}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          id={`${area}-navigation`}
          className={cn(
            'max-h-[55dvh] shrink-0 overflow-y-auto overscroll-contain border-b border-e bg-sidebar p-4 text-sidebar-foreground md:block md:max-h-none md:w-(--sidebar-width) md:border-b-0',
            menuOpen ? 'block' : 'hidden'
          )}
        >
          {profile ? <div className="mb-5 border-b pb-4">{profile}</div> : null}
          <nav aria-label={shellText('navigation', locale)} className="flex flex-col gap-5">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="mb-2 px-3 text-xs font-medium text-muted-foreground">{group.label}</p>
                <ul className="flex flex-col gap-1">
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <li key={to}>
                      <Link
                        to={to}
                        activeOptions={{ exact: true }}
                        className="shell-navigation-link"
                        aria-current={current?.to === to ? 'page' : undefined}
                        onClick={() => setMenuOpen(false)}
                      >
                        <Icon
                          className="size-[1.125rem] shrink-0"
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
                        <span>{label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className="mt-6 border-t pt-4">
            <Link
              to={area === 'admin' ? '/dashboard' : '/tickets'}
              className="shell-navigation-link"
            >
              <ArrowUpRight className="size-4 shrink-0 rtl:-rotate-90" aria-hidden="true" />
              {shellText(area === 'admin' ? 'backToWorkspace' : 'support', locale)}
            </Link>
          </div>
        </aside>
        <main
          id={`${area}-content`}
          tabIndex={-1}
          className="app-content min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-8 lg:p-10"
        >
          <div className="mx-auto w-full max-w-(--container-max-width)">{children}</div>
        </main>
      </div>
    </div>
  );
}
