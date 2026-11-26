import { useRef, useState } from 'react';
import { Badge, Input, Label } from '@barghsa/ui';
import { tCatalogue } from '@barghsa/i18n/catalogue';
import type { Product } from '../lib/catalogue-form.js';

function searchText(value: string, locale: 'en' | 'fa') {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase(locale)
    .replaceAll('ي', 'ی')
    .replaceAll('ك', 'ک')
    .replace(/[\s\u200c]+/g, ' ')
    .trim();
}

export default function SavingPlanHardwarePicker({
  options,
  selected,
  locale,
  title,
  money,
  onChange,
}: {
  options: Product[];
  selected: string[];
  locale: 'en' | 'fa';
  title: (item: Product) => string;
  money: (price: string | null) => string;
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const label = (key: string) => tCatalogue(key, locale);
  const term = searchText(query, locale);
  const needles = term.split(' ');
  const chosen = new Set(selected);
  const products = new Map(options.map((item) => [item.id, item]));
  const matches = options.filter((item) => {
    if (item.status === 'archived' || chosen.has(item.id)) return false;
    if (!term) return true;
    const name = searchText(`${item.title.fa} ${item.title.en}`, locale);
    return needles.every((part) => name.includes(part));
  });

  function choice(id: string) {
    const item = products.get(id);
    const checked = chosen.has(id);
    const inputId = `catalogue-hardware-option-${id}`;
    return (
      <label
        key={id}
        className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50"
      >
        <input
          id={inputId}
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={checked}
          onChange={(event) => {
            const hadFocus = event.currentTarget === document.activeElement;
            onChange(checked ? selected.filter((value) => value !== id) : [...selected, id]);
            if (hadFocus) {
              requestAnimationFrame(() => {
                const moved = document.getElementById(inputId);
                (moved ?? search.current)?.focus();
              });
            }
          }}
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <bdi className="min-w-0 wrap-anywhere font-medium">{item ? title(item) : id}</bdi>
            {(!item || item.status !== 'active') && (
              <Badge variant="secondary">
                {label(!item || item.status === 'archived' ? 'unavailable' : 'inactive')}
              </Badge>
            )}
          </span>
          {item && (
            <span className="min-w-0 wrap-anywhere text-xs text-muted-foreground">
              {money(item.price)}
            </span>
          )}
        </span>
      </label>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/35 p-2">
        <h3 className="px-2 text-xs font-semibold">{label('selectedPlanHardware')}</h3>
        {selected.length ? (
          <div className="max-h-48 overflow-y-auto">{selected.map(choice)}</div>
        ) : (
          <p className="px-2 pt-1 text-xs text-muted-foreground">
            {label('noPlanHardwareSelected')}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="catalogue-hardware-search">{label('searchPlanHardware')}</Label>
        <Input
          ref={search}
          id="catalogue-hardware-search"
          type="search"
          dir="auto"
          maxLength={120}
          value={query}
          placeholder={label('searchPlanHardwareHint')}
          aria-controls="catalogue-hardware-results"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault();
          }}
        />
      </div>
      <div id="catalogue-hardware-results">
        {matches.length ? (
          <div className="max-h-56 overflow-y-auto overscroll-contain rounded-lg border p-1">
            {matches.map((item) => choice(item.id))}
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {label(term ? 'noPlanHardwareMatches' : 'noAdditionalPlanHardware')}
          </p>
        )}
      </div>
    </div>
  );
}
