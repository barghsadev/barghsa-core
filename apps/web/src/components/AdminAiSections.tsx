import { useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Tabs, ScrollableTabsList, TabsTrigger, TabsContent } from '@barghsa/ui';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { useLocale } from '../hooks/useLocale.js';
import { useNavigation } from '../hooks/useNavigation.js';

const sections = [
  { to: '/admin/ai-models', key: 'admin.aiModels.title' },
  { to: '/admin/knowledge-bases', key: 'admin.kb.title' },
  { to: '/admin/policies', key: 'admin.policies.title' },
  { to: '/admin/agents', key: 'admin.agents.title' },
  { to: '/admin/agent-slots', key: 'admin.slots.title' },
];
// The five route instances share one pending focus target in this browser.
let requestedSection: string | null = null;

/** Imported only by AI route components, so other settings keep their existing bundle. */
export default function AdminAiSections({
  section,
  children,
}: {
  section: string;
  children: ReactNode;
}) {
  const locale = useLocale(),
    navigation = useNavigation(),
    navigate = useNavigate();
  const items = sections.filter(
    (item) => navigation?.area === 'staff' && navigation.paths.includes(item.to)
  );
  // The outgoing route may observe the new URL before it unmounts. Only the
  // destination route instance may select its tab and consume the focus target.
  const current = items.find((item) => item.to === section)?.to;
  const selectedTab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (current && requestedSection === current) {
      requestedSection = null;
      selectedTab.current?.focus();
    }
  }, [current]);
  if (!current) return <>{children}</>;
  return (
    <Tabs
      value={current}
      onValueChange={(target) => {
        if (
          target === current ||
          typeof target !== 'string' ||
          !items.some((item) => item.to === target)
        )
          return;
        requestedSection = target;
        void navigate({ to: target }).catch(() => {
          if (requestedSection === target) requestedSection = null;
        });
      }}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <ScrollableTabsList
        aria-label={t('admin.settings.ai', locale)}
        activateOnFocus={false}
        previousLabel={t('admin.settings.previousSection', locale)}
        nextLabel={t('admin.settings.nextSection', locale)}
      >
        {items.map((item) => (
          <TabsTrigger
            key={item.to}
            value={item.to}
            className="pointer-coarse:flex-none"
            ref={item.to === current ? selectedTab : undefined}
          >
            {t(item.key, locale)}
          </TabsTrigger>
        ))}
      </ScrollableTabsList>
      {items.map((item) => (
        <TabsContent key={item.to} value={item.to}>
          {item.to === current ? children : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
