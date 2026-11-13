import type { ComponentProps } from 'react';
import type { ContractElectricityLimits } from '@barghsa/shared/admin';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  contractLimitBasis,
  contractLimitFields,
  validContractLimits,
} from '../lib/limit-settings-form.js';
import ConfigRecovery from './ConfigRecovery.js';

type Props = Omit<
  ComponentProps<typeof ConfigRecovery<ContractElectricityLimits>>,
  'valid' | 'basis' | 'renderValues'
>;

export default function ContractLimitsRecovery(props: Props) {
  const numbers = useNumberFormatting(useLocale());
  return (
    <ConfigRecovery
      {...props}
      valid={validContractLimits}
      basis={contractLimitBasis}
      renderValues={(config, label) => (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
          {contractLimitFields.map(({ key }) => (
            <div key={key} className="contents">
              <dt>{label(key)}</dt>
              <dd>
                <bdi>{numbers.number(config[key])}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      )}
    />
  );
}
