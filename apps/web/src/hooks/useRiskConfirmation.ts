import { useConfirmationGate } from '@barghsa/ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import type { Locale } from '@barghsa/i18n/app';

/** Keep domain-owned dialogs and their existing authentication/receipt protocol. */
export function useRiskConfirmation(
  scope: unknown,
  locale: Locale,
  risk: 'destructive' | 'financial' | 'both'
) {
  return useConfirmationGate(scope, {
    ...(risk !== 'financial'
      ? {
          confirmation: {
            phrase: confirmationText('phrase', locale),
            label: confirmationText('typePhrase', locale),
          },
        }
      : {}),
    ...(risk !== 'destructive' ? { acknowledgement: confirmationText('acknowledge', locale) } : {}),
  });
}
