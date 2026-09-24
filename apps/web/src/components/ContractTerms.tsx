import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { parseContractCommercialValue } from '../lib/contracts.js';
import { ContractCommercialValueText } from './ContractCommercialValueText.js';
/** Render stored terms as text, formatting only the validated top-level commercial value. */
export function ContractTerms({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const locale = useLocale();
  const word = (key: string) => contractText(key, locale);
  if (value === null || value === undefined) return <span>{word('noValue')}</span>;
  if (typeof value === 'boolean') return <span>{word(value ? 'yes' : 'no')}</span>;
  if (typeof value !== 'object')
    return (
      <span className="whitespace-pre-wrap break-words" dir="auto">
        {String(value)}
      </span>
    );
  // Unusually deep imported snapshots remain readable without unbounded recursion.
  if (depth >= 20)
    return (
      <pre className="overflow-auto whitespace-pre-wrap break-words" dir="auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  if (Array.isArray(value))
    return (
      <ol className="flex list-inside list-decimal flex-col gap-2">
        {value.map((item, index) => (
          <li key={index}>
            <ContractTerms value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  return (
    <dl className="flex flex-col gap-3">
      {Object.entries(value).map(([key, item]) => {
        const commercialValue =
          depth === 0 && key === 'commercialValue' ? parseContractCommercialValue(item) : null;
        return (
          <div key={key} className="border-s-2 ps-3">
            <dt className="text-sm text-muted-foreground">
              {word(
                key === 'title'
                  ? 'titleField'
                  : depth === 0 && key === 'commercialValue'
                    ? 'statedContractValue'
                    : key
              )}
            </dt>
            <dd>
              {commercialValue ? (
                <ContractCommercialValueText value={commercialValue} />
              ) : (
                <ContractTerms value={item} depth={depth + 1} />
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
