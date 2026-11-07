import { Icon } from './Icon.js';
import type { ReactNode, RefObject } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@barghsa/ui';
import { Menu, X, ChevronRight } from 'lucide-react';
import { shellText } from '@barghsa/i18n/shell';
import { BrandMark } from './BrandMark.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';
import { ThemeSwitcher } from './ThemeSwitcher.js';
import { ProfileMenu } from './ProfileMenu.js';

export function Topbar({
  area,
  locale,
  isWide,
  currentLabel,
  actions,
  profileBadge,
  menuOpen,
  menuButton,
  onMenuToggle,
  onAccountOpen,
  navigationId,
}: {
  area: 'dashboard' | 'admin';
  locale: 'fa' | 'en';
  isWide: boolean;
  currentLabel: string | undefined;
  actions: ReactNode;
  profileBadge?: ReactNode;
  menuOpen: boolean;
  menuButton: RefObject<HTMLButtonElement | null>;
  onMenuToggle: () => void;
  onAccountOpen: () => void;
  navigationId: string;
}) {
  const title = shellText(area === 'admin' ? 'administration' : 'workspace', locale);
  const preferences = (
    <>
      <ThemeSwitcher />
      <LanguageSwitcher />
    </>
  );
  return (
    <header className="shell-topbar">
      <Link
        to="/app"
        aria-label={shellText('workspace', locale)}
        className={isWide ? 'hidden' : 'shell-topbar-brand'}
      >
        <BrandMark compact />
      </Link>
      <div className="shell-topbar-context">
        <span className="shrink-0 text-muted-foreground">{title}</span>
        {currentLabel ? (
          <>
            <Icon
              icon={ChevronRight}
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="truncate font-medium">{currentLabel}</span>
          </>
        ) : null}
      </div>
      <div className="shell-topbar-actions">
        {isWide && <div className="hidden lg:contents">{preferences}</div>}
        <ProfileMenu
          area={area}
          locale={locale}
          onOpen={onAccountOpen}
          profileBadge={!isWide ? profileBadge : undefined}
          preferences={
            !isWide ? (
              <div className="flex flex-wrap items-center gap-3">{preferences}</div>
            ) : undefined
          }
        />
        {actions}
        <Button
          ref={menuButton}
          variant="ghost"
          size="icon"
          className="lg:hidden"
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
