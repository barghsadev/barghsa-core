import { useState } from 'react';
import { SearchIcon } from 'lucide-react';
import { Input } from '@barghsa/ui';
import { aiAgentFormText } from '@barghsa/i18n/ai-agent-forms';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { catalogueSearchText } from '../lib/catalogue-search.js';
import type { CatalogueChoice } from './CatalogueChoicePicker.js';

export function AgentLinkChoiceList({
  locale,
  group,
  options,
  selected,
  disabled,
  noOptions,
  onChange,
}: {
  locale: 'en' | 'fa';
  group: string;
  options: CatalogueChoice[];
  selected: string[];
  disabled: boolean;
  noOptions: string;
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const numbers = useNumberFormatting(locale);
  const copy = (key: Parameters<typeof aiAgentFormText>[0]) => aiAgentFormText(key, locale);
  const query = catalogueSearchText(search);
  const visible = query
    ? options.filter((option) => catalogueSearchText(option.title).includes(query))
    : options;
  const showSearch = options.length > 6 || !!search;
  return (
    <>
      {showSearch && (
        <div className="mb-1.5 space-y-1">
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              autoComplete="off"
              aria-label={copy('searchLinksLabel').replace('{group}', group)}
              placeholder={copy('searchLinks')}
              disabled={disabled}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault();
              }}
              className="h-10 ps-9"
            />
          </div>
          <p role="status" className="text-xs text-muted-foreground">
            {copy('selectedLinks').replace('{count}', numbers.number(selected.length))}
          </p>
        </div>
      )}
      {!visible.length && (
        <p className="text-sm text-muted-foreground">
          {query ? copy('noMatchingLinks') : noOptions}
        </p>
      )}
      <div className="max-h-60 overflow-y-auto">
        {visible.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <label
              key={option.id}
              className="flex min-h-10 items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/60"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={checked}
                disabled={disabled || (!checked && selected.length >= 200)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, option.id]
                      : selected.filter((id) => id !== option.id)
                  )
                }
              />
              <bdi className="min-w-0 break-words">{option.title}</bdi>
            </label>
          );
        })}
      </div>
    </>
  );
}
