import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import type { ContractCommercialValue } from '../lib/contracts.js';

export function ContractCommercialValueText({ value }: { value: ContractCommercialValue }) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  if (value.kind === 'fixed') return <span>{numbers.money(value.amountIrr)}</span>;
  return (
    <span>
      {contractText('variableContractValue', locale)}: {value.description}
    </span>
  );
}
