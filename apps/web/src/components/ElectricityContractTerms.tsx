import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';

export interface ElectricityContractTermsSnapshot {
  name: string;
  versionNumber: number;
  text: string;
}

export function ElectricityContractTerms({
  template,
}: {
  template: ElectricityContractTermsSnapshot | null | undefined;
}) {
  const locale = useLocale();
  if (!template) return <p>{t('electricity.order.contractPreviewText', locale)}</p>;

  return (
    <div className="space-y-2">
      <p className="font-medium text-foreground">
        {template.name} · {t('electricity.order.contractTemplateVersion', locale)}{' '}
        {template.versionNumber}
      </p>
      <div className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-4 text-foreground">
        {template.text}
      </div>
    </div>
  );
}
