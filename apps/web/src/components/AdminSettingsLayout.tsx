import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Button, Label, NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@barghsa/ui';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { activeAdminSettingsPath, adminSettingsGroups } from '../lib/admin-settings-navigation.js';
import type { NavigationGroup } from './AppShell.js';

/** Mobile settings shortcut inside the admin shell. */
export function AdminSettingsLayout({
  groups,
  locale,
  children,
}: {
  groups: readonly NavigationGroup[];
  locale: 'fa' | 'en';
  children: ReactNode;
}) {
  const { pathname } = useLocation(),
    navigate = useNavigate();
  const settings = adminSettingsGroups(groups, locale),
    current = activeAdminSettingsPath(pathname);
  const [choice, setChoice] = useState<string | null>(null);
  const requested = useRef<string | null>(null),
    content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setChoice(null);
    if (requested.current === pathname) {
      requested.current = null;
      content.current?.focus();
    }
  }, [pathname]);
  if (!current) return <>{children}</>;
  const items = settings.flatMap((group) => group.items),
    label = items.find((item) => item.to === current)?.label;
  if (!label || items.length < 2) return <>{children}</>;
  const navigationLabel = t('admin.settings.navigation', locale);
  const destination = choice && items.some((item) => item.to === choice) ? choice : current;
  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="admin-settings-layout">
      <div className="space-y-2 lg:hidden">
        <Label htmlFor="admin-settings-section">{navigationLabel}</Label>
        <div className="flex flex-wrap gap-2">
          <NativeSelect
            id="admin-settings-section"
            className="min-w-0 flex-1"
            value={destination}
            onChange={(event) => setChoice(event.target.value)}
          >
            {settings.map((group) => (
              <NativeSelectOptGroup key={group.label} label={group.label}>
                {group.items.map((item) => (
                  <NativeSelectOption key={item.to} value={item.to}>
                    {item.label}
                  </NativeSelectOption>
                ))}
              </NativeSelectOptGroup>
            ))}
          </NativeSelect>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={destination === current}
            onClick={() => {
              if (destination === current) return;
              requested.current = destination;
              void navigate({ to: destination }).catch(() => {
                if (requested.current === destination) requested.current = null;
              });
            }}
          >
            {t('admin.settings.openSection', locale)}
          </Button>
        </div>
      </div>
      <div
        ref={content}
        role="region"
        aria-label={label}
        tabIndex={-1}
        className="min-w-0 outline-none"
      >
        {children}
      </div>
    </div>
  );
}
