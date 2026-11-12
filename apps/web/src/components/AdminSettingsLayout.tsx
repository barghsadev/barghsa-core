import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Label, NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@barghsa/ui';
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
  const requested = useRef<string | null>(null),
    content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (requested.current === pathname) {
      requested.current = null;
      content.current?.focus();
    }
  }, [pathname]);
  if (!current) return <>{children}</>;
  const items = settings.flatMap((group) => group.items),
    label = items.find((item) => item.to === current)?.label;
  if (!label) return <>{children}</>;
  const navigationLabel = t('admin.settings.navigation', locale);
  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="admin-settings-layout">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-col gap-2 lg:hidden">
          <Label htmlFor="admin-settings-section">{navigationLabel}</Label>
          <NativeSelect
            id="admin-settings-section"
            className="w-full"
            tabIndex={0}
            value={current}
            onChange={(event) => {
              const target = event.target.value;
              if (target === current || !items.some((item) => item.to === target)) return;
              requested.current = target;
              void navigate({ to: target }).catch(() => {
                requested.current = null;
              });
            }}
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
    </div>
  );
}
