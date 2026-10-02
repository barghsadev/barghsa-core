import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { cn } from '@barghsa/ui';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import { Topbar } from './Topbar.js';
import { shellText } from '@barghsa/i18n/shell';
import { BreadcrumbBar } from './BreadcrumbBar.js';
import { currentNavigation } from '../lib/shell-navigation.js';
import {
  AnalyticsConsentBanner,
  AnalyticsConsentProvider,
} from '../providers/AnalyticsConsentProvider.js';

export interface NavigationGroup {
  label: string;
  items: { to: string; label: string; icon: LucideIcon }[];
}

function subscribeCompactNavigation(listener: () => void) {
  const media = window.matchMedia('(min-width: 1024px)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
const compactNavigation = () => !window.matchMedia('(min-width: 1024px)').matches;
type CompactBarComponent = typeof import('./BottomTabBar.js').BottomTabBar;

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
  const compact = useSyncExternalStore(subscribeCompactNavigation, compactNavigation, () => false);
  const [CompactBar, setCompactBar] = useState<CompactBarComponent | null>(null);
  const [compactError, setCompactError] = useState(false);
  useEffect(() => {
    if (!compact || CompactBar) return;
    let cancelled = false;
    setCompactError(false);
    void import('./BottomTabBar.js')
      .then((module) => {
        if (!cancelled) setCompactBar(() => module.BottomTabBar);
      })
      .catch(() => {
        if (!cancelled) setCompactError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [compact, CompactBar]);
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
  const current = currentNavigation(groups, pathname);
  const shell = (
    <div
      className="flex h-dvh flex-col bg-background text-foreground [--mobile-navigation-height:calc(4rem+env(safe-area-inset-bottom))] lg:[--mobile-navigation-height:0px]"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <a href={`#${area}-content`} className="sr-only focus:not-sr-only focus:bg-card focus:p-3">
        {shellText('skip', locale)}
      </a>
      {banners}
      <AnalyticsConsentBanner />
      <Topbar
        area={area}
        locale={locale}
        isWide={!compact}
        currentLabel={current?.label}
        actions={actions}
        menuOpen={menuOpen}
        menuButton={menuButton}
        onMenuToggle={() => setMenuOpen(!menuOpen)}
        onAccountOpen={() => setMenuOpen(false)}
        navigationId={`${area}-navigation`}
      />
      <BreadcrumbBar groups={groups} pathname={pathname} area={area} locale={locale} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside
          id={`${area}-navigation`}
          className={cn(
            'max-h-[55dvh] shrink-0 overflow-y-auto overscroll-contain border-b border-e bg-sidebar p-4 text-sidebar-foreground lg:block lg:max-h-none lg:w-(--sidebar-width) lg:border-b-0',
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
          {area === 'dashboard' && (
            <div className="mt-6 border-t pt-4">
              <Link to="/tickets" className="shell-navigation-link">
                <ArrowUpRight className="size-4 shrink-0 rtl:-rotate-90" aria-hidden="true" />
                {shellText('support', locale)}
              </Link>
            </div>
          )}
        </aside>
        <main
          id={`${area}-content`}
          tabIndex={-1}
          className="app-content min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-8 lg:p-10"
        >
          <div className="mx-auto w-full max-w-(--container-max-width)">{children}</div>
        </main>
      </div>
      {compact &&
        (CompactBar ? (
          <CompactBar
            area={area}
            locale={locale}
            groups={groups}
            pathname={pathname}
            onOpen={() => setMenuOpen(false)}
            onFallback={() => {
              setMenuOpen(true);
              menuButton.current?.focus();
            }}
          />
        ) : (
          <div
            role="region"
            aria-label={shellText('quickNavigation', locale)}
            className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-t bg-card px-4 pb-[env(safe-area-inset-bottom)]"
          >
            <p role={compactError ? 'alert' : 'status'} className="text-sm text-muted-foreground">
              {shellText(compactError ? 'navigationError' : 'navigationLoading', locale)}
            </p>
            {compactError && (
              <button
                type="button"
                className="min-h-10 px-2 font-semibold text-primary"
                onClick={() => {
                  setMenuOpen(true);
                  menuButton.current?.focus();
                }}
              >
                {shellText('menu', locale)}
              </button>
            )}
          </div>
        ))}
    </div>
  );
  return (
    <AnalyticsConsentProvider area={area === 'admin' ? 'admin' : 'customer'}>
      {shell}
    </AnalyticsConsentProvider>
  );
}
