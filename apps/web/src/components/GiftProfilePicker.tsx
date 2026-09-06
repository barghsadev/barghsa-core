import { useEffect, useState } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
interface ProfileOption {
  id: string;
  title: string;
  profileType: string;
  archived: boolean;
}
export function GiftProfilePicker({
  ids,
  onChange,
  label,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  label: (key: string) => string;
}) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [revision, setRevision] = useState(0);
  const [options, setOptions] = useState<ProfileOption[]>([]),
    [selected, setSelected] = useState<ProfileOption[]>([]);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(false),
    [selectedError, setSelectedError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(false);
    setOptions([]);
    void fetch(`/api/admin/promotions/gift-codes/profiles?search=${encodeURIComponent(query)}`, {
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Load failed');
        return (await response.json()) as ProfileOption[];
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
  }, [query, revision]);
  useEffect(() => {
    const abort = new AbortController();
    setSelectedError(false);
    setSelected([]);
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 200) batches.push(ids.slice(i, i + 200));
    void Promise.all(
      batches.map(async (batch) => {
        const response = await fetch(
          `/api/admin/promotions/gift-codes/profiles?ids=${encodeURIComponent(batch.join(','))}`,
          { signal: abort.signal }
        );
        if (!response.ok) throw new Error('Load failed');
        return (await response.json()) as ProfileOption[];
      })
    )
      .then((rows) => {
        if (!abort.signal.aborted) setSelected(rows.flat());
      })
      .catch(() => {
        if (!abort.signal.aborted) setSelectedError(true);
      });
    return () => abort.abort();
  }, [ids, revision]);
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
            setRevision((value) => value + 1);
          }}
        >
          {label('search')}
        </Button>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{label('profileHelp')}</p>
      {loading && <p role="status">{label('loading')}</p>}
      {(error || selectedError) && <p role="alert">{label('profileError')}</p>}
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
      {!loading && !error && !allIds.length && <p>{label('noProfiles')}</p>}
    </fieldset>
  );
}
