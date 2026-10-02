import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link } from '@tanstack/react-router';
import { Ellipsis } from 'lucide-react';
import { shellText } from '@barghsa/i18n/shell';
import type { NavigationGroup } from './AppShell.js';
import type { MobileNavigationSheetProps } from './MobileNavigationSheet.js';
import { currentNavigation } from '../lib/shell-navigation.js';
import { mobileNavigation } from '../lib/mobile-navigation.js';

export function BottomTabBar({
  area,
  locale,
  groups,
  pathname,
  onOpen,
  onFallback,
}: {
  area: 'dashboard' | 'admin';
  locale: 'en' | 'fa';
  groups: NavigationGroup[];
  pathname: string;
  onOpen: () => void;
  onFallback: () => void;
}) {
  const { primary, remaining } = mobileNavigation(groups, area);
  const current = currentNavigation(groups, pathname);
  const primaryActive = primary.some((item) => item.to === current?.to);
  const [open, setOpen] = useState(false);
  const [Sheet, setSheet] = useState<ComponentType<MobileNavigationSheetProps> | null>(null);
  const [error, setError] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const media = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (media.matches) {
        setOpen(false);
        document.getElementById(`${area}-content`)?.focus();
      }
    };
    closeOnDesktop();
    media.addEventListener('change', closeOnDesktop);
    return () => media.removeEventListener('change', closeOnDesktop);
  }, [open, area]);
  useEffect(() => {
    if (!open || Sheet) return;
    let cancelled = false;
    setError(false);
    void import('./MobileNavigationSheet.js')
      .then((module) => {
        if (!cancelled) setSheet(() => module.default);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, Sheet]);
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (!value) trigger.current?.focus();
  };
  return (
    <>
      <nav
        aria-label={shellText('quickNavigation', locale)}
        className="grid shrink-0 grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {primary.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: true }}
            aria-current={current?.to === to ? 'page' : undefined}
            className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary aria-[current=page]:bg-primary/10 aria-[current=page]:font-semibold aria-[current=page]:text-primary"
          >
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            <span className="line-clamp-2">{label}</span>
          </Link>
        ))}
        {remaining.length > 0 && (
          <button
            ref={trigger}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-current={current && !primaryActive ? 'page' : undefined}
            className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary aria-[current=page]:bg-primary/10 aria-[current=page]:font-semibold aria-[current=page]:text-primary"
            onClick={() => {
              onOpen();
              setOpen(true);
            }}
          >
            <Ellipsis className="size-5" aria-hidden="true" />
            <span>{shellText('more', locale)}</span>
          </button>
        )}
      </nav>
      {open && !Sheet && (
        <div className="fixed inset-x-4 bottom-[calc(var(--mobile-navigation-height)+1rem)] z-50 rounded-lg border bg-card p-4 shadow-lg lg:hidden">
          {error ? (
            <div role="alert">
              <p>{shellText('navigationError', locale)}</p>
              <button
                type="button"
                className="mt-2 min-h-10 font-semibold text-primary"
                onClick={() => {
                  setOpen(false);
                  onFallback();
                }}
              >
                {shellText('menu', locale)}
              </button>
            </div>
          ) : (
            <p role="status">{shellText('navigationLoading', locale)}</p>
          )}
          <button
            type="button"
            className="mt-2 min-h-10 text-primary"
            onClick={() => changeOpen(false)}
          >
            {shellText('close', locale)}
          </button>
        </div>
      )}
      {Sheet && (
        <Sheet
          open={open}
          locale={locale}
          groups={remaining}
          currentTo={current?.to}
          onOpenChange={changeOpen}
        />
      )}
    </>
  );
}
