import { useEffect } from 'react';
import { Toaster, toast } from 'sonner';
import { feedbackText } from '@barghsa/i18n/feedback';
import { useLocale } from '../hooks/useLocale.js';
import { useBrandConfig } from '../providers/BrandThemeProvider.js';

export function ApplicationToaster() {
  const locale = useLocale();
  const { brandConfig } = useBrandConfig();
  useEffect(
    () => () => {
      // A profile-context reset must not retain messages from the old profile.
      toast.dismiss();
    },
    []
  );
  return (
    <Toaster
      theme={brandConfig.darkMode ? 'dark' : 'light'}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      position={locale === 'fa' ? 'bottom-left' : 'bottom-right'}
      customAriaLabel={feedbackText('region', locale)}
      closeButton
      duration={6000}
      toastOptions={{ closeButtonAriaLabel: feedbackText('close', locale) }}
    />
  );
}
