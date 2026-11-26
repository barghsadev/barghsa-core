import { SearchIcon } from 'lucide-react';
import { ComboBox, ComboBoxInput, ComboBoxItem, ComboBoxPopup } from '@barghsa/ui';
import type { WizardFieldBinding } from '../hooks/useWizardForm.js';
import { usePickerSearch } from '../hooks/usePickerSearch.js';
import { catalogueSearchText } from '../lib/catalogue-search.js';

export type CatalogueChoice = {
  id: string;
  title: string;
  detail?: string | undefined;
  searchText?: string;
};

export function CatalogueChoicePicker({
  id,
  locale,
  options,
  selected,
  required = true,
  disabled,
  field,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
  labels,
  onChange,
}: {
  id: string;
  locale: 'en' | 'fa';
  options: CatalogueChoice[];
  selected: string;
  required?: boolean;
  disabled: boolean;
  field?: Partial<WizardFieldBinding>;
  'aria-invalid'?: boolean | undefined;
  'aria-describedby'?: string | undefined;
  labels: { search: string; noMatches: string; empty: string; unavailable: string };
  onChange: (id: string) => void;
}) {
  const selectedOption =
    options.find((option) => option.id === selected) ??
    (selected ? { id: selected, title: labels.unavailable } : null);
  const search = usePickerSearch(selectedOption?.title ?? '', field?.onBlur);
  const query = catalogueSearchText(search.query);

  return (
    <ComboBox
      items={options}
      filteredItems={
        query
          ? options.filter((option) =>
              catalogueSearchText(`${option.title} ${option.searchText ?? ''}`).includes(query)
            )
          : options
      }
      value={selectedOption}
      {...search.rootProps}
      itemToStringLabel={(option) => option.title}
      itemToStringValue={(option) => option.id}
      isItemEqualToValue={(option, value) => option.id === value.id}
      openOnInputClick
      autoHighlight
      disabled={disabled}
      onValueChange={(option, details) => {
        if (disabled || !option || !options.some((row) => row.id === option.id)) {
          if (details.reason === 'escape-key' && !search.searching) details.allowPropagation();
          details.cancel();
          return;
        }
        onChange(option.id);
      }}
    >
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <ComboBoxInput
        id={id}
        ref={field?.ref}
        {...search.inputProps}
        placeholder={labels.search}
        aria-required={required || undefined}
        aria-invalid={invalid ?? field?.['aria-invalid']}
        aria-describedby={describedBy ?? field?.['aria-describedby']}
        className="h-11 ps-9 aria-invalid:border-destructive"
      />
      {/* Keep the portal inside the viewport while the app form scrolls independently. */}
      <ComboBoxPopup
        positionMethod="fixed"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        emptyMessage={options.length ? labels.noMatches : labels.empty}
        className="max-h-[min(18rem,var(--available-height))] w-(--anchor-width) min-w-0 p-1 data-closed:animate-none"
      >
        {(option: CatalogueChoice) => (
          <ComboBoxItem
            key={option.id}
            value={option}
            className="min-h-11 data-highlighted:bg-primary/10 data-highlighted:text-foreground"
            aria-label={option.title}
            aria-description={option.detail}
          >
            <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <bdi className="min-w-0 [overflow-wrap:anywhere]">{option.title}</bdi>
              {option.detail && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {option.detail}
                </span>
              )}
            </span>
          </ComboBoxItem>
        )}
      </ComboBoxPopup>
    </ComboBox>
  );
}
