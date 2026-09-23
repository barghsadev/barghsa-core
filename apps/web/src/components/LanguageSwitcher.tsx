import { Languages } from 'lucide-react';
import { Button } from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import { useLocale } from '../hooks/useLocale.js';
import { setLanguagePreference } from '../lib/entry-locale.js';

/** Changes the current interface language without navigating or resetting forms. */
export function LanguageSwitcher() {
  const locale = useLocale();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={shellText('language', locale)}
      onClick={() => {
        const next = locale === 'fa' ? 'en' : 'fa';
        setLanguagePreference(next);
      }}
    >
      <Languages aria-hidden="true" data-icon="inline-start" />
      <span lang={locale === 'fa' ? 'en' : 'fa'}>{locale === 'fa' ? 'English' : 'فارسی'}</span>
    </Button>
  );
}
