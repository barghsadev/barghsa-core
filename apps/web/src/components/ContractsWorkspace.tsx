import { ContractRefundQueue } from './ContractRefundQueue.js';
import { ContractCancellationRequestQueue } from './ContractCancellationRequestQueue.js';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  EmptyState,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  NativeSelect,
  PageHeader,
  PageLoading,
  StatusBadge,
} from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { documentRequest } from '../lib/documents.js';
import { contractBase, contractStates, type ContractSummary } from '../lib/contracts.js';
import { ContractActivationRules } from './ContractActivationRules.js';
import { ContractDetail } from './ContractDetail.js';
import { ContractDraftEditor } from './ContractDraftEditor.js';

export function ContractsWorkspace({ staff = false }: { staff?: boolean }) {
  const revision = useProfileContextRevision();
  return <Workspace key={`${staff}:${revision}`} staff={staff} />;
}
function Workspace({ staff }: { staff: boolean }) {
  const locale = useLocale();
  const word = (key: string) => contractText(key, locale);
  const [filters, setFilters] = useState({ profileId: '', state: '', serviceType: '' });
  const [query, setQuery] = useState('');
  const [generation, setGeneration] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  function apply(event: FormEvent) {
    event.preventDefault();
    if (
      filters.profileId &&
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(filters.profileId)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setCreatedId(null);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    setQuery(params.toString());
    setGeneration((value) => value + 1);
  }
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <PageHeader
        title={word(staff ? 'staffTitle' : 'title')}
        description={word(staff ? 'staffDescription' : 'description')}
      />
      {staff ? (
        <form onSubmit={apply} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <FieldGroup className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="contracts-profile">{word('profile')}</FieldLabel>
              <Input
                id="contracts-profile"
                dir="ltr"
                value={filters.profileId}
                onChange={(e) => setFilters({ ...filters, profileId: e.target.value.trim() })}
                aria-invalid={invalid}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="contracts-state">{word('state')}</FieldLabel>
              <NativeSelect
                id="contracts-state"
                value={filters.state}
                onChange={(e) => setFilters({ ...filters, state: e.target.value })}
              >
                <option value="">{word('all')}</option>
                {contractStates.map((state) => (
                  <option key={state} value={state}>
                    {word(state)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="contracts-service">{word('serviceType')}</FieldLabel>
              <NativeSelect
                id="contracts-service"
                value={filters.serviceType}
                onChange={(e) => setFilters({ ...filters, serviceType: e.target.value })}
              >
                <option value="">{word('all')}</option>
                {['electricity', 'savings', 'solar'].map((type) => (
                  <option key={type} value={type}>
                    {word(type)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          {invalid ? <p role="alert">{word('invalidProfile')}</p> : null}
          <Button type="submit" className="self-start">
            {word('apply')}
          </Button>
        </form>
      ) : null}
      {staff ? (
        <ContractDraftEditor
          onSaved={(id) => {
            setCreatedId(id);
            setGeneration((value) => value + 1);
          }}
        />
      ) : null}
      {staff ? <ContractRefundQueue /> : null}
      {staff ? <ContractCancellationRequestQueue /> : null}
      {staff ? <ContractActivationRules /> : null}
      <ContractResults key={generation} staff={staff} query={query} initialSelected={createdId} />
    </div>
  );
}
function ContractResults({
  staff,
  query,
  initialSelected,
}: {
  staff: boolean;
  query: string;
  initialSelected: string | null;
}) {
  const locale = useLocale();
  const word = (key: string) => contractText(key, locale);
  const [items, setItems] = useState<ContractSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(query);
    if (cursor) params.set('before', cursor);
    setLoading(true);
    setError(false);
    void documentRequest<{ contracts: ContractSummary[]; nextBefore: string | null }>(
      `${contractBase(staff)}?${params}`,
      { signal: controller.signal }
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems((previous) =>
          cursor
            ? [
                ...previous,
                ...page.contracts.filter((item) => !previous.some((old) => old.id === item.id)),
              ]
            : page.contracts
        );
        setNext(page.nextBefore);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [staff, query, cursor, reload]);
  function refresh() {
    setItems([]);
    setCursor(null);
    setNext(null);
    setReload((value) => value + 1);
  }
  return (
    <div className="flex flex-col gap-5">
      <Button className="self-start" variant="outline" onClick={refresh} disabled={loading}>
        {word('refresh')}
      </Button>
      {selected ? (
        <ContractDetail
          key={`${selected}:${reload}`}
          id={selected}
          staff={staff}
          onClose={() => setSelected(null)}
          onChanged={refresh}
        />
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      ) : null}
      {loading && !items.length ? <PageLoading label={word('loading')} /> : null}
      {!loading && !error && !items.length ? (
        <EmptyState title={word('empty')} description={word('emptyHint')} />
      ) : null}
      {items.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <Button variant="link" onClick={() => setSelected(item.id)}>
                  {word(item.serviceType)} · {word('version')}{' '}
                  {item.versionNumber.toLocaleString(locale)}
                </Button>
                {item.changeDescription ? (
                  <p className="text-sm text-muted-foreground">{item.changeDescription}</p>
                ) : null}
              </div>
              <StatusBadge label={word(item.state)} />
            </li>
          ))}
        </ul>
      ) : null}
      {next ? (
        <Button variant="outline" disabled={loading} onClick={() => setCursor(next)}>
          {word('next')}
        </Button>
      ) : null}
    </div>
  );
}
