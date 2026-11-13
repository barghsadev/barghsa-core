import type { ComponentProps } from 'react';
import type { GreenElectricityConfig } from '@barghsa/shared/finance';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  electricityModes,
  greenBasis,
  validGreenConfig,
} from '../lib/electricity-settings-form.js';
import ConfigRecovery from './ConfigRecovery.js';

type Copy = (key: string) => string;

function RuleValues({ config, label }: { config: GreenElectricityConfig; label: Copy }) {
  const numbers = useNumberFormatting(useLocale());
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {electricityModes.map((mode) => (
        <div key={mode} className="min-w-0 space-y-1 rounded-md border bg-card p-3 text-sm">
          <p className="font-medium">{label(mode)}</p>
          <p>{label(config[mode].mandatoryGreenEnabled ? 'enabledState' : 'disabledState')}</p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-2">
            <dt>{label('threshold')}</dt>
            <dd>
              <bdi>{numbers.number(config[mode].averagePowerThresholdKw)}</bdi>
            </dd>
            <dt>{label('share')}</dt>
            <dd>
              <bdi>{numbers.percent(config[mode].mandatoryGreenSharePercent / 100)}</bdi>
            </dd>
          </dl>
        </div>
      ))}
    </div>
  );
}

type Props = Omit<
  ComponentProps<typeof ConfigRecovery<GreenElectricityConfig>>,
  'path' | 'valid' | 'basis' | 'renderValues'
>;

export default function GreenRulesRecovery(props: Props) {
  return (
    <ConfigRecovery
      {...props}
      path="/api/admin/config/green-electricity-rules"
      valid={validGreenConfig}
      basis={greenBasis}
      renderValues={(config, label) => <RuleValues config={config} label={label} />}
    />
  );
}
