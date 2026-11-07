import { Icon } from './Icon.js';
import { useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { shellText } from '@barghsa/i18n/shell';
import type { NavigationGroup } from './AppShell.js';
import { currentNavigation } from '../lib/shell-navigation.js';

export function BreadcrumbBar({
  groups,
  pathname,
  area,
  locale,
}: {
  groups: NavigationGroup[];
  pathname: string;
  area: 'admin' | 'dashboard';
  locale: 'en' | 'fa';
}) {
  const current = currentNavigation(groups, pathname);
  const root = {
    to: '/app',
    label: shellText(area === 'admin' ? 'administration' : 'workspace', locale),
  };
  const crumbs =
    pathname === '/app'
      ? [root]
      : [
          root,
          ...(current && current.to !== '/app' ? [current] : []),
          ...(pathname !== current?.to
            ? [{ to: pathname, label: shellText('details', locale) }]
            : []),
        ];
  const parents = crumbs.slice(0, -1);
  const last = crumbs.at(-1)!;
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (disclosure.current) disclosure.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      const details = disclosure.current;
      if (
        event.key === 'Escape' &&
        details?.open &&
        event.target instanceof Node &&
        details.contains(event.target)
      ) {
        event.preventDefault();
        details.open = false;
        details.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, []);
  const parentLink = (crumb: typeof root) => (
    <Link
      to={crumb.to}
      className="shell-breadcrumb-parent"
      aria-label={shellText('backToPage', locale).replace('{page}', crumb.label)}
    >
      {crumb.label}
    </Link>
  );
  const separator = (
    <Icon
      icon={ChevronRight}
      className="size-3.5 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
  );
  return (
    <nav aria-label={shellText('breadcrumbs', locale)} className="shell-breadcrumbs">
      <ol className="flex min-w-0 flex-wrap items-center gap-2">
        {parents.map((crumb) => (
          <li key={crumb.to} className="hidden items-center gap-2 lg:flex">
            {parentLink(crumb)}
            {separator}
          </li>
        ))}
        <li className="flex items-center gap-2 lg:hidden">
          {parents.length > 0 && (
            <>
              <details ref={disclosure} className="relative">
                <summary
                  aria-label={shellText('parentPages', locale)}
                  className="shell-breadcrumb-trigger"
                >
                  …
                </summary>
                <ol className="shell-breadcrumb-menu">
                  {parents.map((crumb) => (
                    <li key={crumb.to}>{parentLink(crumb)}</li>
                  ))}
                </ol>
              </details>
              {separator}
            </>
          )}
        </li>
        <li className="min-w-0">
          <span aria-current="page" className="block truncate font-medium">
            {last.label}
          </span>
        </li>
      </ol>
    </nav>
  );
}
