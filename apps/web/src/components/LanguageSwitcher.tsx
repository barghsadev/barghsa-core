import { Languages } from 'lucide-react';
import { Button } from '@barghsa/ui';
import { publicShellText } from '@barghsa/i18n/public-shell';
import { useLocale } from '../hooks/useLocale.js';
import { setLanguagePreference } from '../lib/entry-locale.js';

/** Changes the current interface language without navigating or resetting forms. */
export function LanguageSwitcher() {
  const locale = useLocale();
  return (
    <Button
      variant="ghost"
      size="default"
      aria-label={publicShellText('language', locale)}
      onClick={() => {
        const next = locale === 'fa' ? 'en' : 'fa';
        setLanguagePreference(next);
      }}
    >
      <Languages aria-hidden="true" data-icon="inline-start" />
      <span className="inline" lang={locale === 'fa' ? 'en' : 'fa'}>
        {publicShellText('languageCode', locale)}
      </span>
    </Button>
  );
}
