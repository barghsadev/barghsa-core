import { useEffect, useState, useId } from 'react';
import { Button, Field, FieldGroup, FieldLabel, Input, NativeSelect } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { documentRequest } from '../lib/documents.js';

type Choice = { id: string; title?: string; profileType?: string; serviceType?: string };
type Options = { profiles?: Choice[]; orders?: Choice[]; nextBefore: string | null };

export function ContractDraftChoices({
  profileId,
  serviceType,
  value,
  onChange,
}: {
  profileId?: string;
  serviceType?: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [rows, setRows] = useState<Choice[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true),
    [failed, setFailed] = useState(false);
  const fieldId = useId();
  const order = profileId !== undefined;
  useEffect(() => {
    const abort = new AbortController();
    setBusy(true);
    setFailed(false);
    const params = new URLSearchParams(order ? { profileId } : { search: query });
    if (cursor) params.set('before', cursor);
    void documentRequest<Options>(`/api/admin/contracts/authoring-options?${params}`, {
      signal: abort.signal,
    })
      .then((result) => {
        if (abort.signal.aborted) return;
        const options = order ? result.orders : result.profiles;
        if (!Array.isArray(options)) throw new Error('Missing draft options');
        setRows((previous) =>
          cursor
            ? [
                ...previous,
                ...options.filter((row) => !previous.some((item) => item.id === row.id)),
              ]
            : options
        );
        setNext(result.nextBefore);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [order, profileId, query, cursor, revision]);
  return (
    <FieldGroup>
      {!order ? (
        <Field>
          <FieldLabel htmlFor={fieldId + '-search'}>{word('draftSearchProfiles')}</FieldLabel>
          <div className="flex gap-2">
            <Input
              id={fieldId + '-search'}
              value={search}
              maxLength={100}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onChange('');
                setRows([]);
                setNext(null);
                setCursor(null);
                setQuery(search.trim());
                setRevision((n) => n + 1);
              }}
            >
              {word('draftSearch')}
            </Button>
          </div>
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor={fieldId + '-choice'}>
          {word(order ? 'draftOrder' : 'draftProfile')}
        </FieldLabel>
        <NativeSelect
          id={fieldId + '-choice'}
          value={value}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{word(order ? 'draftNoOrder' : 'draftChooseProfile')}</option>
          {rows
            .filter((row) => !order || row.serviceType === serviceType)
            .map((row) => (
              <option key={row.id} value={row.id}>
                {order
                  ? `${word(row.serviceType!)} · ${row.id}`
                  : `${row.title || word('draftUnnamedProfile')} · ${word(row.profileType === 'LEGAL' ? 'draftLegal' : 'draftIndividual')} · ${row.id.slice(-8)}`}
              </option>
            ))}
        </NativeSelect>
      </Field>
      {busy ? <p role="status">{word('loading')}</p> : null}
      {failed ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert">{word('draftOptionsError')}</p>
          <Button type="button" variant="outline" onClick={() => setRevision((n) => n + 1)}>
            {word('refresh')}
          </Button>
        </div>
      ) : null}
      {!busy && !failed && !rows.length ? <p>{word('draftNoMatches')}</p> : null}
      {next && !failed ? (
        <Button
          className="self-start"
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => setCursor(next)}
        >
          {word('next')}
        </Button>
      ) : null}
    </FieldGroup>
  );
}
