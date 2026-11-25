import { readWithDeadline } from '../lib/server-query-client.js';
import { useEffect, useRef, useState } from 'react';
import { LoadingStatus, Button, Input, Label } from '@barghsa/ui';
interface ProfileOption {
  id: string;
  title: string;
  profileType: string;
  archived: boolean;
}
function isProfileOptions(value: unknown): value is ProfileOption[] {
  return (
    Array.isArray(value) &&
    value.length <= 200 &&
    value.every(
      (row) =>
        !!row &&
        typeof row === 'object' &&
        typeof row.id === 'string' &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(row.id) &&
        typeof row.title === 'string' &&
        typeof row.profileType === 'string' &&
        typeof row.archived === 'boolean'
    ) &&
    new Set(value.map((row) => row.id)).size === value.length
  );
}
export function GiftProfilePicker({
  ids,
  onChange,
  label,
  onDenied,
}: {
  ids: string[];
  onChange?: (ids: string[]) => void;
  label: (key: string) => string;
  onDenied?: () => void;
}) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [searchRevision, setSearchRevision] = useState(0),
    [selectedRevision, setSelectedRevision] = useState(0);
  const [options, setOptions] = useState<ProfileOption[]>([]),
    [selected, setSelected] = useState<ProfileOption[]>([]);
  const editable = onChange !== undefined;
  const [loading, setLoading] = useState(editable),
    [selectedLoading, setSelectedLoading] = useState(ids.length > 0),
    [error, setError] = useState(false),
    [selectedError, setSelectedError] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  // Form renders can recreate the array without changing the selected UUIDs.
  const selectedIds = ids.join(',');
  useEffect(() => {
    if (!editable) return;
    const abort = new AbortController();
    setLoading(true);
    setError(false);
    setOptions([]);
    void readWithDeadline(abort.signal, async (signal) => {
      const response = await fetch(
        `/api/admin/promotions/gift-codes/profiles?search=${encodeURIComponent(query)}`,
        {
          signal,
        }
      );
      signal.throwIfAborted();
      if (response.status === 401 || response.status === 403) onDenied?.();
      if (!response.ok) throw new Error('Load failed');
      const data: unknown = await response.json();
      if (!isProfileOptions(data)) throw new Error('Invalid profile options');
      return data;
    })
      .then((rows) => {
        if (!abort.signal.aborted) setOptions(rows);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [query, searchRevision, onDenied, editable]);
  useEffect(() => {
    const abort = new AbortController();
    const requestedIds = selectedIds ? selectedIds.split(',') : [];
    setSelectedError(false);
    setSelected([]);
    setSelectedLoading(requestedIds.length > 0);
    const batches: string[][] = [];
    for (let i = 0; i < requestedIds.length; i += 200) {
      batches.push(requestedIds.slice(i, i + 200));
    }
    void readWithDeadline(abort.signal, (signal) =>
      Promise.all(
        batches.map(async (batch) => {
          const response = await fetch(
            `/api/admin/promotions/gift-codes/profiles?ids=${encodeURIComponent(batch.join(','))}`,
            { signal }
          );
          signal.throwIfAborted();
          if (response.status === 401 || response.status === 403) onDenied?.();
          if (!response.ok) throw new Error('Load failed');
          const data: unknown = await response.json();
          if (!isProfileOptions(data)) throw new Error('Invalid profile options');
          return data;
        })
      )
    )
      .then((rows) => {
        if (!abort.signal.aborted) setSelected(rows.flat());
      })
      .catch(() => {
        if (!abort.signal.aborted) setSelectedError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setSelectedLoading(false);
      });
    return () => abort.abort();
  }, [selectedIds, selectedRevision, onDenied]);
  const byId = new Map([...options, ...selected].map((row) => [row.id, row]));
  if (!onChange)
    return (
      <section className="space-y-2 border-t pt-4">
        <h2 className="font-medium">{label('profiles')}</h2>
        {selectedLoading ? (
          <LoadingStatus>{label('loading')}</LoadingStatus>
        ) : selectedError ? (
          <div role="alert" className="space-y-2">
            <p>{label('profileError')}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSelectedRevision((value) => value + 1)}
            >
              {label('retry')}
            </Button>
          </div>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {ids.map((id) => (
              <li key={id} className="rounded-md border px-3 py-1 text-sm">
                <bdi>{byId.get(id)?.title || label('untitledProfile')}</bdi>
                {byId.get(id)?.archived && ` · ${label('archived')}`}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  const chosen = new Set(ids);
  const matches = options.filter((row) => !chosen.has(row.id));
  const applySearch = () => {
    setQuery(search.trim());
    setSearchRevision((value) => value + 1);
  };
  const renderChoice = (id: string) => {
    const row = byId.get(id);
    const checked = chosen.has(id);
    const inputId = `gift-profile-option-${id}`;
    return (
      <label
        key={id}
        className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40 has-disabled:cursor-not-allowed"
      >
        <input
          type="checkbox"
          id={inputId}
          className="size-4 shrink-0 accent-primary"
          checked={checked}
          disabled={row?.archived && !checked}
          onChange={(event) => {
            const input = event.currentTarget;
            const retainFocus = document.activeElement === input;
            onChange(input.checked ? [...ids, id] : ids.filter((value) => value !== id));
            if (retainFocus)
              requestAnimationFrame(() => {
                if (!searchInput.current) return;
                const next = document.getElementById(inputId);
                const target =
                  next instanceof HTMLInputElement && !next.disabled ? next : searchInput.current;
                target.focus();
              });
          }}
        />
        <span className="min-w-0 text-sm wrap-anywhere">
          <bdi className="block font-medium">{row?.title || label('untitledProfile')}</bdi>
          {row && (
            <span className="block text-xs text-muted-foreground">
              {label(row.profileType === 'LEGAL' ? 'legal' : 'individual')}
              {row.archived && ` · ${label('archived')}`}
            </span>
          )}
        </span>
      </label>
    );
  };
  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border px-3 pb-3">
      <legend className="px-1 font-semibold">{label('profiles')}</legend>
      <div className="space-y-1.5">
        <Label htmlFor="gift-profile-search">{label('searchProfiles')}</Label>
        <div className="flex min-w-0 gap-2">
          <Input
            ref={searchInput}
            id="gift-profile-search"
            maxLength={100}
            className="min-w-0 flex-1"
            aria-describedby="gift-profile-help"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                applySearch();
              }
            }}
          />
          <Button type="button" variant="outline" className="shrink-0" onClick={applySearch}>
            {label('search')}
          </Button>
        </div>
        <p id="gift-profile-help" className="text-xs text-muted-foreground">
          {label('profileHelp')}
        </p>
      </div>
      {(loading || selectedLoading) && <LoadingStatus>{label('loading')}</LoadingStatus>}
      {(error || selectedError) && (
        <div role="alert" className="space-y-2">
          <p>{label('profileError')}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (error) setSearchRevision((value) => value + 1);
              if (selectedError) setSelectedRevision((value) => value + 1);
            }}
          >
            {label('retry')}
          </Button>
        </div>
      )}
      {ids.length > 0 && (
        <section className="space-y-1 rounded-lg bg-muted/40 p-2">
          <h3 className="px-2 text-xs font-semibold">{label('chosenProfiles')}</h3>
          <div className="max-h-56 overflow-y-auto">{ids.map(renderChoice)}</div>
        </section>
      )}
      <section className="space-y-1">
        <h3 className="text-xs font-semibold">{label('profileMatches')}</h3>
        {matches.length > 0 && (
          <div className="max-h-64 divide-y overflow-y-auto">
            {matches.map((row) => renderChoice(row.id))}
          </div>
        )}
        <div aria-live="polite">
          {!loading && !error && matches.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {label(options.length === 0 ? 'noProfiles' : 'allMatchesSelected')}
            </p>
          )}
        </div>
      </section>
    </fieldset>
  );
}
