import type { ComponentProps } from 'react';
import { tServiceSettings } from '@barghsa/i18n/service-settings';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  thresholdBasis,
  validThreshold,
  type ThresholdSetting,
} from '../lib/limit-settings-form.js';
import ConfigRecovery from './ConfigRecovery.js';

type Props = Omit<
  ComponentProps<typeof ConfigRecovery<ThresholdSetting>>,
  'valid' | 'basis' | 'renderValues' | 'activationRisk' | 'requiresOtp'
>;

export default function DualApprovalThresholdRecovery({ label, ...props }: Props) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  return (
    <ConfigRecovery
      {...props}
      label={(key) => {
        if (key === 'recoveryTitle' || key === 'recoveryActivateConfirm') return label(key);
        const copy = tServiceSettings(`recovery.${key}`, locale);
        return copy === `recovery.${key}` ? label(key) : copy;
      }}
      showRevisions
      valid={validThreshold}
      basis={thresholdBasis}
      requiresOtp
      activationRisk={(value) => (value.thresholdIrR === 0 ? 'destructive' : undefined)}
      renderValues={(value) => (
        <div className="space-y-2">
          <p className="font-medium tabular-nums">{numbers.money(value.thresholdIrR)}</p>
          {value.thresholdIrR === 0 && <p>{label('disabled')}</p>}
        </div>
      )}
    />
  );
}
