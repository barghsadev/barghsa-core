import { readWithDeadline } from '../lib/server-query-client.js';
import { useEffect, useState } from 'react';
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
  onChange: (ids: string[]) => void;
  label: (key: string) => string;
  onDenied?: () => void;
}) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [searchRevision, setSearchRevision] = useState(0),
    [selectedRevision, setSelectedRevision] = useState(0);
  const [options, setOptions] = useState<ProfileOption[]>([]),
    [selected, setSelected] = useState<ProfileOption[]>([]);
  const [loading, setLoading] = useState(true),
    [selectedLoading, setSelectedLoading] = useState(ids.length > 0),
    [error, setError] = useState(false),
    [selectedError, setSelectedError] = useState(false);
  // Form renders can recreate the array without changing the selected UUIDs.
  const selectedIds = ids.join(',');
  useEffect(() => {
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
  }, [query, searchRevision, onDenied]);
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
  const allIds = [...new Set([...ids, ...options.map((row) => row.id)])];
  return (
    <fieldset className="min-w-0 rounded-md border p-4">
      <legend className="px-1 font-semibold">{label('profiles')}</legend>
      <Label htmlFor="gift-profile-search">{label('searchProfiles')}</Label>
      <div className="my-2 flex gap-2">
        <Input
          id="gift-profile-search"
          maxLength={100}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setQuery(search.trim());
            setSearchRevision((value) => value + 1);
          }}
        >
          {label('search')}
        </Button>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{label('profileHelp')}</p>
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
      <div className="flex max-h-64 flex-col gap-3 overflow-y-auto">
        {allIds.map((id) => {
          const row = byId.get(id);
          return (
            <label key={id} className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={ids.includes(id)}
                disabled={row?.archived && !ids.includes(id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked ? [...ids, id] : ids.filter((value) => value !== id)
                  )
                }
              />
              <span className="min-w-0 break-words">
                {row?.title || label('untitledProfile')}
                {row && ` · ${label(row.profileType === 'LEGAL' ? 'legal' : 'individual')}`}
                {row?.archived && ` · ${label('archived')}`}
              </span>
            </label>
          );
        })}
      </div>
      {!loading && !error && !selectedError && !allIds.length && <p>{label('noProfiles')}</p>}
    </fieldset>
  );
}
