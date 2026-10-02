import { useSyncExternalStore, type RefObject } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@barghsa/ui';
import { Menu, X, ChevronRight } from 'lucide-react';
import { shellText } from '@barghsa/i18n/shell';
import { BrandMark } from './BrandMark.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';
import { ThemeSwitcher } from './ThemeSwitcher.js';
import { ProfileMenu } from './ProfileMenu.js';
import type { ReactNode } from 'react';

function subscribeWideHeader(listener: () => void) {
  const media = window.matchMedia('(min-width: 1024px)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
const wideHeader = () => window.matchMedia('(min-width: 1024px)').matches;

export function Topbar({
  area,
  locale,
  currentLabel,
  actions,
  menuOpen,
  menuButton,
  onMenuToggle,
  onAccountOpen,
  navigationId,
}: {
  area: 'dashboard' | 'admin';
  locale: 'fa' | 'en';
  currentLabel: string | undefined;
  actions: ReactNode;
  menuOpen: boolean;
  menuButton: RefObject<HTMLButtonElement | null>;
  onMenuToggle: () => void;
  onAccountOpen: () => void;
  navigationId: string;
}) {
  const isWide = useSyncExternalStore(subscribeWideHeader, wideHeader, () => true);
  const title = shellText(area === 'admin' ? 'administration' : 'workspace', locale);
  return (
    <header className="flex min-h-(--topbar-height) shrink-0 items-center gap-1 border-b bg-card px-2 sm:gap-3 sm:px-4 md:px-6">
      <Link
        to="/app"
        aria-label={shellText('workspace', locale)}
        className="flex min-h-11 min-w-11 items-center text-foreground no-underline md:w-[calc(var(--sidebar-width)-3rem)]"
      >
        <BrandMark />
      </Link>
      <div className="hidden min-w-0 flex-1 items-center gap-2 text-sm md:flex">
        <span className="shrink-0 text-muted-foreground">{title}</span>
        {currentLabel ? (
          <>
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground rtl:rotate-180"
              aria-hidden="true"
            />
            <span className="truncate font-medium">{currentLabel}</span>
          </>
        ) : null}
      </div>
      <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
        {isWide && (
          <>
            <ThemeSwitcher />
            <LanguageSwitcher />
          </>
        )}
        <ProfileMenu
          area={area}
          locale={locale}
          onOpen={onAccountOpen}
          preferences={
            !isWide ? (
              <div className="flex flex-wrap items-center gap-3">
                <ThemeSwitcher />
                <LanguageSwitcher />
              </div>
            ) : undefined
          }
        />
        {actions}
        <Button
          ref={menuButton}
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={shellText('menu', locale)}
          aria-expanded={menuOpen}
          aria-controls={navigationId}
          onClick={onMenuToggle}
        >
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </Button>
      </div>
    </header>
  );
}
