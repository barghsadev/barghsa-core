import { useEffect } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@barghsa/ui/sonner';
import { feedbackText } from '@barghsa/i18n/feedback';
import { useLocale } from '../hooks/useLocale.js';
import { useTheme } from '../hooks/useTheme.js';
import { connectToast } from '../lib/toast-api.js';

export default function SonnerToaster() {
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  useEffect(() => connectToast(toast), []);
  return (
    <Toaster
      theme={resolvedTheme}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      position={locale === 'fa' ? 'bottom-left' : 'bottom-right'}
      customAriaLabel={feedbackText('region', locale)}
      closeButton
      duration={6000}
      toastOptions={{ closeButtonAriaLabel: feedbackText('close', locale) }}
    />
  );
}
