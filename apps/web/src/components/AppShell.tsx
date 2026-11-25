import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation, useRouter } from '@tanstack/react-router';
import { Animated } from '@barghsa/ui';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import './app-shell.css';
import { BrandMark } from './BrandMark.js';
import { Topbar } from './Topbar.js';
import { shellText } from '@barghsa/i18n/shell';
import { BreadcrumbBar } from './BreadcrumbBar.js';
import { TableActionTooltips } from './TableActionTooltips.js';
import { InsideRouteMain } from './RouteFallbackLandmark.js';
import type { FileRoutesByTo } from '../routeTree.gen.js';
import { currentNavigation } from '../lib/shell-navigation.js';
import {
  AnalyticsConsentBanner,
  AnalyticsConsentProvider,
} from '../providers/AnalyticsConsentProvider.js';

export interface NavigationGroup {
  label: string;
  disclosure?: { id: string; icon: LucideIcon };
  items: { to: keyof FileRoutesByTo; label: string; icon: LucideIcon; activePath?: RegExp }[];
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
  floating,
  profile,
  profileBadge,
  actions,
  navigationUnavailable = false,
  focused = false,
}: {
  area: 'dashboard' | 'admin';
  locale: 'fa' | 'en';
  groups: NavigationGroup[];
  children: ReactNode;
  banners?: ReactNode;
  floating?: ReactNode;
  profile?: ReactNode;
  profileBadge?: ReactNode;
  actions?: ReactNode;
  navigationUnavailable?: boolean;
  focused?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const pathname = useLocation({ select: (location) => location.pathname });
  const [disclosures, setDisclosures] = useState({
    pathname,
    expanded: {} as Record<string, boolean>,
  });
  const router = useRouter();
  const compact = useSyncExternalStore(subscribeCompactNavigation, compactNavigation, () => false);
  const [CompactBar, setCompactBar] = useState<CompactBarComponent | null>(null);
  const [compactError, setCompactError] = useState(false);
  useEffect(() => {
    if (!compact || focused || CompactBar) return;
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
  }, [compact, focused, CompactBar]);
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
  const currentGroup = groups.find((group) => group.items.some((item) => item.to === currentPath));
  if (area === 'admin' && pathname !== disclosures.pathname) {
    const expanded = { ...disclosures.expanded };
    if (currentGroup?.disclosure && expanded[currentGroup.disclosure.id] === false)
      delete expanded[currentGroup.disclosure.id];
    setDisclosures({ pathname, expanded });
  }
  useEffect(() => {
    if (area !== 'admin') return;
    const link = sidebar.current?.querySelector('[aria-current="page"]');
    const group = link?.closest<HTMLElement>('.shell-sidebar-group-items');
    if (!link || group?.inert) return;
    const scrollToCurrent = () => link.scrollIntoView({ block: 'nearest' });
    const transitions = group?.getAnimations() ?? [];
    if (!transitions.length) {
      scrollToCurrent();
      return;
    }
    let cancelled = false;
    void Promise.allSettled(transitions.map((transition) => transition.finished)).then(() => {
      if (!cancelled && !group?.inert) scrollToCurrent();
    });
    return () => {
      cancelled = true;
    };
  }, [area, compact, currentPath, locale, menuOpen]);
  const closeMenu = () => setMenuOpen(false);
  const openMenu = () => {
    setMenuOpen(true);
    menuButton.current?.focus();
  };
  const shell = (
    <div
      className="app-shell"
      data-area={area}
      data-no-navigation={groups.length === 0 || focused || undefined}
      data-focused={focused || undefined}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {banners}
      <AnalyticsConsentBanner />
      <div className="shell-frame">
        <Topbar
          area={area}
          locale={locale}
          isWide={!compact}
          breadcrumbs={
            focused ? null : (
              <BreadcrumbBar groups={groups} pathname={pathname} area={area} locale={locale} />
            )
          }
          actions={actions}
          profileBadge={profileBadge}
          menuOpen={menuOpen}
          menuButton={menuButton}
          onMenuToggle={() => setMenuOpen(!menuOpen)}
          onAccountOpen={closeMenu}
          navigationId={`${area}-navigation`}
        />
        <aside
          ref={sidebar}
          id={`${area}-navigation`}
          data-expanded={menuOpen}
          className="app-shell-sidebar"
        >
          <Link
            to="/app"
            aria-label={shellText('workspace', locale)}
            className="shell-sidebar-brand"
          >
            <BrandMark compact={compact && !menuOpen} />
          </Link>
          {profile ? (
            <div className="shell-sidebar-detail shell-sidebar-profile">{profile}</div>
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
            {groups.map((group) => {
              const disclosure = group.disclosure;
              const listId = disclosure ? `${area}-navigation-${disclosure.id}` : undefined;
              const isCurrent = group === currentGroup;
              const expanded = disclosure
                ? (disclosures.expanded[disclosure.id] ?? isCurrent)
                : true;
              const links = (
                <ul>
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <li key={to}>
                      <Link
                        to={to}
                        activeOptions={{ exact: true }}
                        className="shell-navigation-link"
                        aria-label={label}
                        aria-current={currentPath === to ? 'page' : undefined}
                        onClick={closeMenu}
                      >
                        <Icon strokeWidth={1.7} aria-hidden="true" />
                        <span className="shell-sidebar-detail">{label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              );
              return (
                <div
                  key={disclosure?.id ?? group.label}
                  className="shell-sidebar-group"
                  data-disclosure={disclosure ? '' : undefined}
                >
                  {disclosure ? (
                    <button
                      type="button"
                      className="shell-sidebar-group-toggle"
                      aria-label={group.label}
                      aria-expanded={expanded}
                      aria-controls={listId}
                      data-current={isCurrent || undefined}
                      onClick={() =>
                        setDisclosures((value) => ({
                          ...value,
                          expanded: { ...value.expanded, [disclosure.id]: !expanded },
                        }))
                      }
                    >
                      <disclosure.icon strokeWidth={1.7} aria-hidden="true" />
                      <span className="shell-sidebar-detail">{group.label}</span>
                      <ChevronDown className="shell-sidebar-detail" aria-hidden="true" />
                    </button>
                  ) : (
                    <p className="shell-sidebar-detail">{group.label}</p>
                  )}
                  {disclosure ? (
                    <div
                      id={listId}
                      className="shell-sidebar-group-items"
                      data-open={expanded || undefined}
                      inert={!expanded}
                    >
                      {links}
                    </div>
                  ) : (
                    links
                  )}
                </div>
              );
            })}
          </nav>
        </aside>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <main
          id="main-content"
          data-area={area}
          tabIndex={-1}
          className={focused ? 'app-content max-lg:scroll-pb-24' : 'app-content'}
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
        !focused &&
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
      {floating}
      <TableActionTooltips key={pathname} />
    </div>
  );
  return (
    <AnalyticsConsentProvider area={area === 'admin' ? 'admin' : 'customer'}>
      {shell}
    </AnalyticsConsentProvider>
  );
}
