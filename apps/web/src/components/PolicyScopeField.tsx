import { useState } from 'react';
import { X } from 'lucide-react';
import { Button, Label } from '@barghsa/ui';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { CatalogueChoicePicker, type CatalogueChoice } from './CatalogueChoicePicker.js';
import { RecordListField } from './RecordListField.js';

const scopeLimit = 200;

function validKnowledgeChoices(value: unknown): value is CatalogueChoice[] {
  return (
    Array.isArray(value) &&
    value.every((row) => row && typeof row.id === 'string' && typeof row.title === 'string')
  );
}

export function PolicyScopeField({
  id,
  locale,
  value,
  disabled,
  descriptionId,
  retryLabel,
  focusRef,
  onBlur,
  onChange,
}: {
  id: string;
  locale: 'en' | 'fa';
  value: string;
  disabled: boolean;
  descriptionId?: string | undefined;
  retryLabel: string;
  focusRef: (element: HTMLElement | null) => void;
  onBlur: () => void;
  onChange: (value: string) => void;
}) {
  const [manual, setManual] = useState(false);
  const scope = useCatalogueScope();
  const catalogue = useCatalogueResource(
    scope,
    '/api/admin/knowledge-bases',
    validKnowledgeChoices
  );
  const copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
    knowledgePolicyFormText(key, locale);
  const refs = value
    .split(/\r?\n/)
    .map((ref) => ref.trim())
    .filter(Boolean);
  const selected = new Set(refs);
  const all = selected.has('all');
  const atLimit = refs.length >= scopeLimit;
  const specific = [...selected].filter((ref) => ref !== 'all');
  const names = new Map(catalogue.data?.map(({ id, title }) => [`kb:${id}`, title]));
  const options = Array.from(names, ([id, title]) => ({ id, title })).filter(
    (choice) => !selected.has(choice.id)
  );
  const helpId = `${id}-scope-help`;
  function remove(ref: string) {
    document.getElementById(atLimit ? `${id}-manual` : id)?.focus();
    onChange(refs.filter((item) => item !== ref).join('\n'));
  }
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {!manual && <Label htmlFor={id}>{copy('addKnowledgeMember')}</Label>}
        <Button
          id={`${id}-manual`}
          type="button"
          size="sm"
          variant="ghost"
          className="ms-auto"
          aria-controls={`${id}-fields`}
          onClick={() => setManual(!manual)}
        >
          {copy(manual ? 'scopeGuided' : 'scopeManual')}
        </Button>
      </div>
      <div id={`${id}-fields`} className="min-w-0 space-y-2.5">
        {manual ? (
          <RecordListField
            id={id}
            label={copy('scopeIds')}
            value={value}
            focusRef={focusRef}
            onBlur={onBlur}
            onChange={onChange}
            limit={scopeLimit}
            rowHelp={copy('scopeManualHint')}
            bulkHelp={copy('scopeManualHint')}
            descriptionId={descriptionId}
            invalid={!!descriptionId}
          />
        ) : (
          <>
            <div className="min-w-0 space-y-1">
              <CatalogueChoicePicker
                id={id}
                locale={locale}
                options={options}
                selected=""
                required={false}
                disabled={disabled || atLimit}
                field={{
                  name: 'items',
                  ref: focusRef,
                  onBlur,
                  'aria-invalid': !!descriptionId || undefined,
                  'aria-describedby': descriptionId ? `${descriptionId} ${helpId}` : helpId,
                }}
                labels={{
                  search: copy('memberSearch'),
                  noMatches: copy('memberNoMatches'),
                  empty: copy(catalogue.loading ? 'scopeLoading' : 'memberNone'),
                  unavailable: '',
                }}
                onChange={(ref) => {
                  if (ref && !atLimit && options.some((choice) => choice.id === ref))
                    onChange([...refs, ref].join('\n'));
                }}
              />
              <p id={helpId} className="text-xs text-muted-foreground">
                {copy(atLimit ? 'scopeLimit' : all ? 'scopeAllSelected' : 'scopePickerHint')}
              </p>
              {(catalogue.error || scope.denied) && (
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <p className="text-xs text-muted-foreground" role="status">
                    {copy(scope.denied ? 'scopeReadDenied' : 'scopeReadError')}
                  </p>
                  {catalogue.error && (
                    <Button type="button" size="sm" variant="ghost" onClick={catalogue.retry}>
                      {retryLabel}
                    </Button>
                  )}
                </div>
              )}
            </div>
            {!!specific.length && (
              <ul aria-label={copy('scopeSelected')} className="flex flex-wrap gap-1.5">
                {specific.map((ref) => {
                  const name = names.get(ref) ?? ref;
                  return (
                    <li
                      key={ref}
                      className="flex min-w-0 max-w-full items-center gap-1 rounded-md border bg-muted/35 ps-2 text-sm"
                    >
                      <bdi className="min-w-0 [overflow-wrap:anywhere]">{name}</bdi>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 shrink-0"
                        aria-label={copy('scopeRemove').replace('{name}', name)}
                        onClick={() => remove(ref)}
                      >
                        <X aria-hidden="true" className="size-4" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="space-y-0.5 border-t pt-2">
              <label className="flex min-h-8 items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={all}
                  disabled={disabled || (!all && atLimit)}
                  aria-describedby={`${id}-all-help`}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...refs, 'all']
                      : refs.filter((ref) => ref !== 'all');
                    onChange(next.join('\n'));
                  }}
                />
                {copy('scopeAll')}
              </label>
              <p id={`${id}-all-help`} className="text-xs text-muted-foreground">
                {copy('scopeAllHint')}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
