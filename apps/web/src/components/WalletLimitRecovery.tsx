import type { ComponentProps } from 'react';
import { tServiceSettings } from '@barghsa/i18n/service-settings';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { record } from '../lib/catalogue-form.js';
import type { WalletLimitSetting } from '../lib/limit-settings-form.js';
import ConfigRecovery from './ConfigRecovery.js';

type Limit = Pick<WalletLimitSetting, 'limitIrR'>;
type Props = Omit<
  ComponentProps<typeof ConfigRecovery<Limit>>,
  'valid' | 'basis' | 'renderValues' | 'activationRisk'
>;
const valid = (value: unknown): value is Limit =>
  record(value) && Number.isSafeInteger(value.limitIrR) && Number(value.limitIrR) >= 0;

export default function WalletLimitRecovery({ label, ...props }: Props) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const recoveryLabel = (key: string) => {
    if (key === 'refresh') return label('refreshHistory');
    const copy = tServiceSettings(`recovery.${key}`, locale);
    return key === 'recoveryTitle' ||
      key === 'recoveryActivateConfirm' ||
      copy === `recovery.${key}`
      ? label(key)
      : copy;
  };
  return (
    <ConfigRecovery
      {...props}
      label={recoveryLabel}
      valid={valid}
      basis={(value) => String(value.limitIrR)}
      activationRisk={(value) => (value.limitIrR === 0 ? 'destructive' : undefined)}
      renderValues={(value) => (
        <div className="space-y-2">
          <p>
            {label('label')} <bdi>{numbers.irrDigits(String(value.limitIrR))}</bdi>
          </p>
          {value.limitIrR === 0 && <p>{label('blocked')}</p>}
        </div>
      )}
    />
  );
}
