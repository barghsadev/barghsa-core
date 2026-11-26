import { useState } from 'react';
import { SearchIcon } from 'lucide-react';
import { ComboBox, ComboBoxInput, ComboBoxItem, ComboBoxPopup } from '@barghsa/ui';
import type { WizardFieldBinding } from '../hooks/useWizardForm.js';
import { catalogueSearchText } from '../lib/catalogue-search.js';

export type CatalogueChoice = { id: string; title: string };

export function CatalogueChoicePicker({
  id,
  locale,
  options,
  selected,
  disabled,
  field,
  labels,
  onChange,
}: {
  id: string;
  locale: 'en' | 'fa';
  options: CatalogueChoice[];
  selected: string;
  disabled: boolean;
  field: WizardFieldBinding;
  labels: { search: string; noMatches: string; empty: string; unavailable: string };
  onChange: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  // Use the latest input even when reopening interrupts a popup close.
  const query = catalogueSearchText(search);
  const selectedOption =
    options.find((option) => option.id === selected) ??
    (selected ? { id: selected, title: labels.unavailable } : null);

  return (
    <ComboBox
      items={options}
      filteredItems={
        query
          ? options.filter((option) => catalogueSearchText(option.title).includes(query))
          : options
      }
      value={selectedOption}
      itemToStringLabel={(option) => option.title}
      itemToStringValue={(option) => option.id}
      isItemEqualToValue={(option, value) => option.id === value.id}
      onInputValueChange={(value, { reason }) => {
        if (reason === 'input-change') setSearch(value);
      }}
      onOpenChange={(open) => {
        if (!open) setSearch('');
      }}
      openOnInputClick
      autoHighlight
      disabled={disabled}
      onValueChange={(option) => {
        if (!disabled && (!option || options.some((row) => row.id === option.id)))
          onChange(option?.id ?? '');
      }}
    >
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <ComboBoxInput
        id={id}
        ref={field.ref}
        onBlur={field.onBlur}
        placeholder={labels.search}
        aria-required="true"
        aria-invalid={field['aria-invalid']}
        aria-describedby={field['aria-describedby']}
        className="h-11 ps-9 aria-invalid:border-destructive"
      />
      <ComboBoxPopup
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        emptyMessage={options.length ? labels.noMatches : labels.empty}
        className="max-h-[min(18rem,var(--available-height))] w-(--anchor-width) min-w-0 p-1 data-closed:animate-none"
      >
        {(option: CatalogueChoice) => (
          <ComboBoxItem key={option.id} value={option} className="min-h-11">
            <bdi className="min-w-0 [overflow-wrap:anywhere]">{option.title}</bdi>
          </ComboBoxItem>
        )}
      </ComboBoxPopup>
    </ComboBox>
  );
}
