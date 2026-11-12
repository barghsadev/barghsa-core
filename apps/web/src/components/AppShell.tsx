import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation, useRouter } from '@tanstack/react-router';
import { Separator, Animated } from '@barghsa/ui';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import { BrandMark } from './BrandMark.js';
import { Topbar } from './Topbar.js';
import { shellText } from '@barghsa/i18n/shell';
import { BreadcrumbBar } from './BreadcrumbBar.js';
import { InsideRouteMain } from './RouteFallbackLandmark.js';
import type { FileRoutesByTo } from '../routeTree.gen.js';
import { currentNavigation } from '../lib/shell-navigation.js';
import {
  AnalyticsConsentBanner,
  AnalyticsConsentProvider,
} from '../providers/AnalyticsConsentProvider.js';

export interface NavigationGroup {
  label: string;
  items: { to: keyof FileRoutesByTo; label: string; icon: LucideIcon }[];
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
  profileBadge,
  actions,
  navigationUnavailable = false,
}: {
  area: 'dashboard' | 'admin';
  locale: 'fa' | 'en';
  groups: NavigationGroup[];
  children: ReactNode;
  banners?: ReactNode;
  profile?: ReactNode;
  profileBadge?: ReactNode;
  actions?: ReactNode;
  navigationUnavailable?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const router = useRouter();
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
  const currentPath = current?.to;
  useEffect(() => {
    if (area !== 'admin' || (compact && !menuOpen) || !currentPath) return;
    sidebar.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }, [area, compact, menuOpen, currentPath]);
  const closeMenu = () => setMenuOpen(false);
  const openMenu = () => {
    setMenuOpen(true);
    menuButton.current?.focus();
  };
  const shell = (
    <div
      className="app-shell"
      data-no-navigation={groups.length === 0 || undefined}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {banners}
      <AnalyticsConsentBanner />
      <Topbar
        area={area}
        locale={locale}
        isWide={!compact}
        breadcrumbs={
          <BreadcrumbBar groups={groups} pathname={pathname} area={area} locale={locale} />
        }
        actions={actions}
        profileBadge={profileBadge}
        menuOpen={menuOpen}
        menuButton={menuButton}
        onMenuToggle={() => setMenuOpen(!menuOpen)}
        onAccountOpen={closeMenu}
        navigationId={`${area}-navigation`}
      />
      <div className="shell-body">
        <aside
          ref={sidebar}
          id={`${area}-navigation`}
          data-area={area}
          data-expanded={menuOpen}
          className="group/sidebar app-shell-sidebar"
        >
          <Link
            to="/app"
            aria-label={shellText('workspace', locale)}
            className="shell-sidebar-brand"
          >
            <BrandMark compact={compact && !menuOpen} />
          </Link>
          {profile ? (
            <div className="mb-5 shell-sidebar-panel">
              {profile}
              <Separator aria-hidden="true" className="mt-4" />
            </div>
          ) : null}
          <nav aria-label={shellText('navigation', locale)} className="shell-sidebar-navigation">
            {navigationUnavailable && (
              <div className="rounded-lg border p-3 text-sm">
                <p role="status">{shellText('navigationUnavailable', locale)}</p>
                <button
                  type="button"
                  className="mt-2 min-h-11 font-semibold text-primary"
                  onClick={() => void router.invalidate()}
                >
                  {shellText('refreshNavigation', locale)}
                </button>
              </div>
            )}
            {groups.map((group) => (
              <div key={group.label} className="shell-sidebar-group">
                <p className="mb-2 px-3 text-xs font-medium text-muted-foreground shell-sidebar-panel">
                  {group.label}
                </p>
                <ul className="flex flex-col gap-1">
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <li key={to}>
                      <Link
                        to={to}
                        activeOptions={{ exact: true }}
                        className="shell-navigation-link"
                        aria-label={label}
                        title={label}
                        aria-current={current?.to === to ? 'page' : undefined}
                        onClick={closeMenu}
                      >
                        <Icon
                          className="size-[1.125rem] shrink-0"
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
                        <span className="shell-sidebar-label">{label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          {area === 'dashboard' && (
            <div className="mt-6">
              <Separator aria-hidden="true" className="mb-4" />
              <Link
                to="/tickets"
                className="shell-navigation-link"
                aria-label={shellText('support', locale)}
                title={shellText('support', locale)}
              >
                <ArrowUpRight className="size-4 shrink-0 rtl:-rotate-90" aria-hidden="true" />
                <span className="shell-sidebar-label">{shellText('support', locale)}</span>
              </Link>
            </div>
          )}
        </aside>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <main
          id="main-content"
          data-area={area}
          tabIndex={-1}
          className="app-content"
          onKeyDown={(event) => {
            if (
              event.target !== event.currentTarget ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey
            )
              return;
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            event.currentTarget.scrollTop += event.key === 'ArrowDown' ? 40 : -40;
          }}
        >
          <Animated variant="page" motionKey={pathname} className="responsive-container">
            <InsideRouteMain value={true}>{children}</InsideRouteMain>
          </Animated>
        </main>
      </div>
      {compact &&
        groups.length > 0 &&
        (CompactBar ? (
          <CompactBar
            area={area}
            locale={locale}
            groups={groups}
            pathname={pathname}
            onOpen={closeMenu}
            onFallback={openMenu}
          />
        ) : (
          <div
            role="region"
            aria-label={shellText('quickNavigation', locale)}
            className="shell-navigation-fallback"
          >
            <p role={compactError ? 'alert' : 'status'} className="text-sm text-muted-foreground">
              {shellText(compactError ? 'navigationError' : 'navigationLoading', locale)}
            </p>
            {compactError && (
              <button
                type="button"
                className="min-h-10 px-2 font-semibold text-primary"
                onClick={openMenu}
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
