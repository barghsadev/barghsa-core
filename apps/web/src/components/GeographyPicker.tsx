import { useState, type ComponentProps, type Ref } from 'react';
import { SearchIcon } from 'lucide-react';
import { ComboBox, ComboBoxClear, ComboBoxInput, ComboBoxItem, ComboBoxPopup } from '@barghsa/ui';
import { addressesText } from '@barghsa/i18n/addresses';
import type { GeographyOption } from '../hooks/useGeographyOptions.js';

const locationMessages = {
  en: {
    province: 'Search or choose a province',
    city: 'Search or choose a city',
    loadingProvinces: 'Loading provinces…',
    noMatch: 'No matching locations',
  },
  fa: {
    province: 'جستجو یا انتخاب استان',
    city: 'جستجو یا انتخاب شهر',
    loadingProvinces: 'در حال دریافت استان‌ها…',
    noMatch: 'موردی پیدا نشد',
  },
};

function matchableName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ');
}

export function GeographyPicker({
  kind,
  locale,
  options,
  selected,
  savedLabel,
  hasProvince = true,
  required = true,
  disabled,
  loading,
  inputRef,
  onChange,
  onBlur,
  ...inputProps
}: {
  kind: 'province' | 'city';
  locale: 'fa' | 'en';
  options: readonly GeographyOption[];
  selected: string;
  savedLabel?: string | undefined;
  hasProvince?: boolean;
  required?: boolean;
  disabled: boolean;
  loading?: boolean;
  inputRef: Ref<HTMLInputElement>;
  onChange: (id: string) => void;
  onBlur: () => void;
} & Pick<ComponentProps<typeof ComboBoxInput>, 'id' | 'aria-invalid' | 'aria-describedby'>) {
  const [search, setSearch] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const label = (option: GeographyOption) => (locale === 'fa' ? option.nameFa : option.nameEn);
  const value =
    options.find((option) => option.id === selected) ??
    (savedLabel ? { id: selected, nameFa: savedLabel, nameEn: savedLabel } : null);
  const direction = locale === 'fa' ? 'rtl' : 'ltr';
  const text = locationMessages[locale];
  const clearLabel = addressesText(kind === 'province' ? 'clearProvince' : 'clearCity', locale);
  const placeholder = !hasProvince
    ? addressesText('provinceFirst', locale)
    : loading
      ? kind === 'city'
        ? addressesText('loadingCities', locale)
        : text.loadingProvinces
      : text[kind];

  return (
    <ComboBox
      items={options}
      value={value}
      inputValue={search ?? (value ? label(value) : '')}
      onInputValueChange={(input, { reason }) => {
        setSearch(reason === 'input-change' ? input : null);
      }}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch(null);
      }}
      itemToStringLabel={label}
      itemToStringValue={(option) => option.id}
      isItemEqualToValue={(option, selection) => option.id === selection.id}
      filter={(option, query) => {
        const search = matchableName(query);
        return (
          matchableName(option.nameFa).includes(search) ||
          matchableName(option.nameEn).includes(search)
        );
      }}
      autoHighlight
      openOnInputClick
      disabled={disabled}
      onValueChange={(option, details) => {
        if (
          disabled ||
          (option ? !options.some(({ id }) => id === option.id) : details.reason !== 'clear-press')
        ) {
          if (details.reason === 'escape-key' && search === null) details.allowPropagation();
          details.cancel();
          return;
        }
        onChange(option?.id ?? '');
      }}
    >
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <ComboBoxInput
        {...inputProps}
        ref={inputRef}
        onBlur={() => {
          if (!open) setSearch(null);
          onBlur();
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.nativeEvent.isComposing &&
            (open || search !== null) &&
            !event.currentTarget.getAttribute('aria-activedescendant')
          ) {
            event.preventDefault();
          }
        }}
        aria-required={required || undefined}
        aria-busy={loading || undefined}
        placeholder={placeholder}
        className={`h-11 ps-9 aria-invalid:border-destructive${value ? ' pe-11' : ''}`}
        dir={direction}
      />
      <ComboBoxClear
        className="absolute end-0 top-1/2 size-11 -translate-y-1/2"
        clearLabel={clearLabel}
        title={clearLabel}
      />
      <ComboBoxPopup
        dir={direction}
        emptyMessage={text.noMatch}
        className="w-(--anchor-width) min-w-0 p-1"
      >
        {(option: GeographyOption) => (
          <ComboBoxItem
            key={option.id}
            value={option}
            aria-label={label(option)}
            className="min-h-10"
          >
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-2">
              <bdi className="font-medium">{label(option)}</bdi>
              {option.nameFa !== option.nameEn && (
                <bdi className="text-xs" lang={locale === 'fa' ? 'en' : 'fa'}>
                  {locale === 'fa' ? option.nameEn : option.nameFa}
                </bdi>
              )}
            </span>
          </ComboBoxItem>
        )}
      </ComboBoxPopup>
    </ComboBox>
  );
}
