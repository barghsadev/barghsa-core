import { useConfirm } from '@barghsa/ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { t } from '@barghsa/i18n/workspace';
import type { Locale } from '@barghsa/i18n/app';
import { useAccountUser } from './useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';

export function useDestructiveConfirm(locale: Locale, scope?: string | number) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const confirm = useConfirm(JSON.stringify([actor, revision, scope, locale]));
  return (title: string, description: string) =>
    confirm({
      title,
      description,
      variant: 'destructive',
      confirmLabel: t('team.confirm', locale),
      cancelLabel: t('team.cancel', locale),
      confirmation: {
        phrase: confirmationText('phrase', locale),
        label: confirmationText('typePhrase', locale),
      },
    });
}
