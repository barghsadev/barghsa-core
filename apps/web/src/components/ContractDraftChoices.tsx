import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  useId,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { Button, Field, FieldLabel, Input, NativeSelect } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { tContractAuthoring } from '@barghsa/i18n/contract-authoring';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { DocumentRequestError } from '../lib/documents.js';
import {
  contractAuthoringOptions,
  type ContractAuthoringChoice,
} from '../lib/contract-authoring-form.js';
import type { ContractFormCoordination } from '../lib/contract-review-signature-form.js';
import { recordEditorField, recordEditorGrid } from './RecordEditorLayout.js';
type Props = {
  profileId?: string;
  serviceType?: string;
  value: string;
  onChange: (id: string) => void;
  coordination?: ContractFormCoordination | undefined;
  blocked?: (() => boolean) | undefined;
  onDenied?: (() => void) | undefined;
  onOptions?: ((ids: string[]) => void) | undefined;
  label?: ReactNode;
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
      label,
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
    const time = useAccountTime(locale, order);
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
    const readContract = useOwnedContractRead(actor, profileRevision, profileId, scope);
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
      if (order && serviceType) params.set('serviceType', serviceType);
      if (cursor) params.set('before', cursor);
      void readContract<unknown>(`/api/admin/contracts/authoring-options?${params}`, {
        signal: abort.signal,
      })
        .then((result) => {
          if (!fresh()) return;
          const parsed = contractAuthoringOptions(result, order);
          if (!parsed || (parsed.nextBefore === cursor && cursor !== null))
            throw new Error('Invalid authoring options');
          // The list can refresh from the same cursor after the review closes.
          const previous =
            cursor && available
              ? rowsRef.current.slice(0, rowsRef.current.findIndex((row) => row.id === cursor) + 1)
              : [];
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
    }, [scope, disabled, readContract]);
    function locked() {
      return disabled || callbacks.current.blocked?.() || callbacks.current.coordination?.blocked();
    }
    function submitSearch() {
      if (locked()) return;
      callbacks.current.onChange('');
      callbacks.current.onOptions?.([]);
      acceptedScope.current = null;
      setRows([]);
      setNext(null);
      setCursor(null);
      setQuery(search.trim());
      setRevision((n) => n + 1);
    }
    const choices = (available ? rows : []).filter(
      (row) => !order || row.serviceType === serviceType
    );
    const selectedOrder = order ? choices.find((row) => row.id === value) : undefined;
    const orderDetails = (row: ContractAuthoringChoice) => {
      const reference = `\u2066…${row.id.slice(-8)}\u2069`;
      return row.createdAt && time.status === 'ready'
        ? `${time.format(row.createdAt, { dateStyle: 'short' })} · ${reference}`
        : reference;
    };
    const orderLabel = (row: ContractAuthoringChoice) => {
      const title =
        row.productTitle?.[locale]?.trim() ||
        row.productTitle?.[locale === 'fa' ? 'en' : 'fa']?.trim() ||
        word(row.serviceType!);
      return `${title} · ${orderDetails(row)}`;
    };
    return (
      <div className={order ? 'min-w-0' : recordEditorGrid}>
        {!order && (
          <Field className="min-w-0 gap-1">
            <FieldLabel htmlFor={fieldId + '-search'}>{word('draftSearchProfiles')}</FieldLabel>
            <div className="flex gap-2">
              <Input
                id={fieldId + '-search'}
                value={search}
                maxLength={100}
                disabled={!!disabled}
                placeholder={tContractAuthoring('profileExample', locale)}
                onChange={(event) => {
                  if (!locked()) setSearch(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  submitSearch();
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!!disabled || !!coordination?.blocked()}
                onClick={submitSearch}
              >
                {word('draftSearch')}
              </Button>
            </div>
          </Field>
        )}
        <div className={recordEditorField}>
          {label ?? (
            <FieldLabel htmlFor={choiceId}>
              {word(order ? 'draftOrder' : 'draftProfile')}
            </FieldLabel>
          )}
          <NativeSelect
            {...control}
            id={choiceId}
            ref={ref}
            value={available ? value : ''}
            className="w-full"
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
            {choices.map((row) => (
              <option key={row.id} value={row.id}>
                {order
                  ? orderLabel(row)
                  : `${row.title || word('draftUnnamedProfile')} · ${word(row.profileType === 'LEGAL' ? 'draftLegal' : 'draftIndividual')} · ${row.id.slice(-8)}`}
              </option>
            ))}
          </NativeSelect>
          {selectedOrder && (
            <p
              aria-hidden="true"
              className="hidden text-xs text-muted-foreground max-[359px]:block"
            >
              {orderDetails(selectedOrder)}
            </p>
          )}
          {busy && (
            <p role="status" className="text-sm text-muted-foreground">
              {word('loading')}
            </p>
          )}
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
          {!busy && !failed && !choices.length && (!order || !next) && (
            <p className="text-sm text-muted-foreground">
              {order ? tContractAuthoring('noOrdersForService', locale) : word('draftNoMatches')}
            </p>
          )}
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
              {order ? tContractAuthoring('moreOrders', locale) : word('next')}
            </Button>
          )}
        </div>
      </div>
    );
  }
);
