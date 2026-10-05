import { forwardRef, useEffect, useRef, useState, useId, type ComponentProps } from 'react';
import { Button, Field, FieldGroup, FieldLabel, Input, NativeSelect } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import {
  contractAuthoringOptions,
  type ContractAuthoringChoice,
} from '../lib/contract-authoring-form.js';
import type { ContractFormCoordination } from '../lib/contract-review-signature-form.js';
type Props = {
  profileId?: string;
  serviceType?: string;
  value: string;
  onChange: (id: string) => void;
  coordination?: ContractFormCoordination | undefined;
  blocked?: (() => boolean) | undefined;
  onDenied?: (() => void) | undefined;
  onOptions?: ((ids: string[]) => void) | undefined;
  labelled?: boolean;
} & Omit<ComponentProps<typeof NativeSelect>, 'value' | 'onChange'>;
export const ContractDraftChoices = forwardRef<HTMLSelectElement, Props>(
  function ContractDraftChoices(
    {
      profileId,
      serviceType,
      value,
      onChange,
      coordination,
      blocked,
      onDenied,
      onOptions,
      labelled = false,
      id,
      disabled,
      onBlur,
      ...control
    },
    ref
  ) {
    const locale = useLocale(),
      word = (key: string) => contractText(key, locale);
    const actor = useAccountUser(),
      profileRevision = useProfileContextRevision();
    const order = profileId !== undefined,
      fieldId = useId(),
      choiceId = id ?? fieldId + '-choice';
    const [search, setSearch] = useState(''),
      [query, setQuery] = useState('');
    const [rows, setRows] = useState<ContractAuthoringChoice[]>([]),
      [next, setNext] = useState<string | null>(null);
    const [cursor, setCursor] = useState<string | null>(null),
      [revision, setRevision] = useState(0);
    const [busy, setBusy] = useState(true),
      [failed, setFailed] = useState(false);
    const parentBlocked = !!coordination?.blocked(),
      parentRevision = coordination?.revision?.();
    const scope = JSON.stringify([
      actor,
      profileRevision,
      profileId,
      serviceType,
      query,
      cursor,
      revision,
      parentBlocked,
      parentRevision,
    ]);
    const current = useRef(scope);
    current.current = scope;
    const acceptedScope = useRef<string | null>(null),
      rowsRef = useRef(rows);
    rowsRef.current = rows;
    const callbacks = useRef({ onChange, onOptions, onDenied, blocked, coordination });
    callbacks.current = { onChange, onOptions, onDenied, blocked, coordination };
    const available =
      acceptedScope.current ===
      JSON.stringify([actor, profileRevision, profileId, serviceType, query]);
    useEffect(() => {
      const abort = new AbortController(),
        parentRevision = coordination?.revision?.();
      const fresh = () =>
        !abort.signal.aborted &&
        current.current === scope &&
        parentRevision === callbacks.current.coordination?.revision?.() &&
        !callbacks.current.coordination?.blocked() &&
        !callbacks.current.blocked?.();
      if (parentBlocked || disabled) {
        setBusy(false);
        return () => abort.abort();
      }
      setBusy(true);
      setFailed(false);
      callbacks.current.onOptions?.([]);
      const params = new URLSearchParams(order ? { profileId } : { search: query });
      if (cursor) params.set('before', cursor);
      void documentRequest<unknown>(`/api/admin/contracts/authoring-options?${params}`, {
        signal: abort.signal,
      })
        .then((result) => {
          if (!fresh()) return;
          const parsed = contractAuthoringOptions(result, order);
          if (!parsed || (parsed.nextBefore === cursor && cursor !== null))
            throw new Error('Invalid authoring options');
          const previous = cursor && available ? rowsRef.current : [];
          if (parsed.rows.some((row) => previous.some((item) => item.id === row.id)))
            throw new Error('Repeated authoring option');
          const nextRows = [...previous, ...parsed.rows];
          acceptedScope.current = JSON.stringify([
            actor,
            profileRevision,
            profileId,
            serviceType,
            query,
          ]);
          setRows(nextRows);
          rowsRef.current = nextRows;
          setNext(parsed.nextBefore);
          callbacks.current.onOptions?.(
            nextRows.filter((row) => !order || row.serviceType === serviceType).map((row) => row.id)
          );
        })
        .catch((failure) => {
          if (!fresh()) return;
          acceptedScope.current = null;
          setRows([]);
          setNext(null);
          setFailed(true);
          callbacks.current.onOptions?.([]);
          if (failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status)) {
            callbacks.current.onChange('');
            callbacks.current.onDenied?.();
          }
        })
        .finally(() => {
          if (fresh()) setBusy(false);
        });
      return () => abort.abort();
    }, [scope, disabled]);
    function locked() {
      return disabled || callbacks.current.blocked?.() || callbacks.current.coordination?.blocked();
    }
    return (
      <FieldGroup>
        {!order && (
          <Field>
            <FieldLabel htmlFor={fieldId + '-search'}>{word('draftSearchProfiles')}</FieldLabel>
            <div className="flex gap-2">
              <Input
                id={fieldId + '-search'}
                value={search}
                maxLength={100}
                disabled={!!disabled}
                onChange={(event) => {
                  if (!locked()) setSearch(event.target.value);
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!!disabled || !!coordination?.blocked()}
                onClick={() => {
                  if (locked()) return;
                  callbacks.current.onChange('');
                  callbacks.current.onOptions?.([]);
                  acceptedScope.current = null;
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
        )}
        {!labelled && (
          <FieldLabel htmlFor={choiceId}>{word(order ? 'draftOrder' : 'draftProfile')}</FieldLabel>
        )}
        <NativeSelect
          {...control}
          id={choiceId}
          ref={ref}
          value={available ? value : ''}
          onBlur={onBlur}
          disabled={busy || failed || !!disabled}
          onChange={(event) => {
            if (
              !locked() &&
              available &&
              (!event.target.value ||
                rowsRef.current.some(
                  (row) =>
                    row.id === event.target.value && (!order || row.serviceType === serviceType)
                ))
            )
              callbacks.current.onChange(event.target.value);
          }}
        >
          <option value="">{word(order ? 'draftNoOrder' : 'draftChooseProfile')}</option>
          {(available ? rows : [])
            .filter((row) => !order || row.serviceType === serviceType)
            .map((row) => (
              <option key={row.id} value={row.id}>
                {order
                  ? `${word(row.serviceType!)} · ${row.id}`
                  : `${row.title || word('draftUnnamedProfile')} · ${word(row.profileType === 'LEGAL' ? 'draftLegal' : 'draftIndividual')} · ${row.id.slice(-8)}`}
              </option>
            ))}
        </NativeSelect>
        {busy && <p role="status">{word('loading')}</p>}
        {failed && (
          <div className="flex flex-col items-start gap-2">
            <p role="alert">{word('draftOptionsError')}</p>
            <Button
              type="button"
              variant="outline"
              disabled={!!disabled || !!coordination?.blocked()}
              onClick={() => {
                if (!locked()) setRevision((n) => n + 1);
              }}
            >
              {word('refresh')}
            </Button>
          </div>
        )}
        {!busy && !failed && (!available || !rows.length) && <p>{word('draftNoMatches')}</p>}
        {next && !failed && (
          <Button
            className="self-start"
            type="button"
            variant="outline"
            disabled={busy || !!disabled || !!coordination?.blocked()}
            onClick={() => {
              if (locked()) return;
              if (cursor === next) setRevision((n) => n + 1);
              else setCursor(next);
            }}
          >
            {word('next')}
          </Button>
        )}
      </FieldGroup>
    );
  }
);
