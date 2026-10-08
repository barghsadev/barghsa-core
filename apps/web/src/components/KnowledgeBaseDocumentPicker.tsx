import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import { useLocale } from '../hooks/useLocale.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from './CatalogueEditorFeedback.js';
import type { RelationOwner } from '../lib/catalogue-membership.js';
import {
  validAvailableKnowledgeDocuments,
  type AvailableKnowledgeDocument,
} from '../lib/knowledge-documents.js';
import { KnowledgeBaseUpload } from './KnowledgeBaseUpload.js';
interface Props {
  attachedKeys: string[];
  disabled?: boolean;
  onDenied?: () => void;
  onAttach: (key: string, owner: RelationOwner) => void;
}
export function KnowledgeBaseDocumentPicker(props: Props) {
  const locale = useLocale(),
    label = (key: string) => t(`admin.kb.${key}`, locale);
  const copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
    knowledgePolicyFormText(key, locale);
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<AvailableKnowledgeDocument[]>([]);
  const live = useRef(props);
  live.current = props;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const search = useWizardForm<{ search: string }>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<{ search: string }>({ search: copy('search') }, (value) =>
        value.search.trim().length > 200 ? ['search'] : []
      );
    },
    { search: '' },
    copy('unavailable')
  );
  const selection = useWizardForm<{ storageKey: string }>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<{ storageKey: string }>(
        { storageKey: copy('storageKey') },
        (value) =>
          !availableRef.current.some((row) => row.storageKey === value.storageKey)
            ? ['storageKey']
            : []
      );
    },
    { storageKey: '' },
    copy('unavailable')
  );
  const fields = useActionFieldErrors(
    selection.form,
    { storageKey: copy('storageKey') },
    copy('invalid')
  );
  const clear = useCallback(() => {
    setFiles([]);
    live.current.onDenied?.();
  }, []);
  const scope = useCatalogueScope(clear);
  const read = useCatalogueResource(
    scope,
    `/api/admin/knowledge-bases/documents/available?search=${encodeURIComponent(query)}`,
    validAvailableKnowledgeDocuments
  );
  useEffect(() => {
    if (read.data) setFiles(read.data);
  }, [read.data]);
  const available = (read.data ?? files).filter(
    (row) => !props.attachedKeys.includes(row.storageKey)
  );
  const availableRef = useRef(available);
  availableRef.current = available;
  const blocked = !!props.disabled || scope.denied || read.loading || read.error;
  const current = useRef({ blocked, query, attached: JSON.stringify(props.attachedKeys) });
  current.current = { blocked, query, attached: JSON.stringify(props.attachedKeys) };
  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (props.disabled || search.isPending() || read.loading) return;
    search.setValidationPending(true);
    try {
      await search.form.handleSubmit((value) => {
        if (!mounted.current || live.current.disabled || scope.denied) return;
        if (value.search.trim() === query) read.retry();
        else setQuery(value.search.trim());
      })();
    } finally {
      if (mounted.current) search.setValidationPending(false);
    }
  }
  async function submitSelection(event: FormEvent) {
    event.preventDefault();
    if (blocked || selection.isPending()) return;
    const captured = current.current;
    selection.setValidationPending(true);
    try {
      await selection.form.handleSubmit((value) => {
        if (
          !mounted.current ||
          current.current.blocked ||
          current.current.query !== captured.query ||
          current.current.attached !== captured.attached ||
          !availableRef.current.some((row) => row.storageKey === value.storageKey)
        )
          return;
        const reset = () => selection.form.reset({ storageKey: '' });
        props.onAttach(value.storageKey, { fields, reset, verified: reset });
      })();
    } finally {
      if (mounted.current) selection.setValidationPending(false);
    }
  }
  if (scope.denied) return <p role="alert">{label('denied')}</p>;
  const chosen = selection.values.storageKey;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <KnowledgeBaseUpload
        disabled={!!props.disabled}
        attachedKeys={props.attachedKeys}
        onDenied={scope.deny}
        onAttach={props.onAttach}
      />
      <p className="text-sm">{label('pickerHelp')}</p>
      <form
        noValidate
        className="flex flex-col gap-2"
        aria-busy={search.pending || read.loading}
        onSubmit={(event) => void submitSearch(event)}
      >
        {catalogueRootMessage(search.errors) && (
          <p role="alert">{catalogueRootMessage(search.errors)}</p>
        )}
        <fieldset
          disabled={props.disabled || search.pending || read.loading}
          className="flex min-w-0 flex-wrap items-end gap-3"
        >
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="kb-file-search">{label('searchFiles')}</Label>
            <Input
              {...search.bind('search')}
              id="kb-file-search"
              value={search.values.search}
              onChange={(event) => search.field('search')[1](event.target.value)}
            />
            <CatalogueFieldFeedback
              id={search.errorId('search')}
              error={search.errors.search}
              message={copy('search')}
            />
          </div>
          <CatalogueSaveButton
            label={label('search')}
            pending={search.pending || read.loading}
            disabled={false}
          />
        </fieldset>
      </form>
      {read.loading && <p role="status">{label('loadingFiles')}</p>}
      {read.error && (
        <div role="alert">
          <p>{label('fileError')}</p>
          <Button type="button" disabled={props.disabled} onClick={read.retry}>
            {label('retry')}
          </Button>
        </div>
      )}
      <form
        noValidate
        className="flex flex-col gap-2"
        aria-busy={selection.pending}
        onSubmit={(event) => void submitSelection(event)}
      >
        {catalogueRootMessage(selection.errors) && (
          <p role="alert">{catalogueRootMessage(selection.errors)}</p>
        )}
        <fieldset
          disabled={blocked || selection.pending}
          className="flex min-w-0 flex-wrap items-end gap-3"
        >
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="kb-file">{label('selectFile')}</Label>
            <select
              {...selection.bind('storageKey')}
              id="kb-file"
              className="max-w-full rounded-md border bg-background p-2"
              value={chosen}
              onChange={(event) => selection.field('storageKey')[1](event.target.value)}
            >
              <option value="">{label('selectFile')}</option>
              {chosen && !available.some((row) => row.storageKey === chosen) && (
                <option value={chosen}>{label('unavailable')}</option>
              )}
              {available.map((row) => (
                <option key={row.storageKey} value={row.storageKey}>
                  {row.fileName}
                </option>
              ))}
            </select>
            <CatalogueFieldFeedback
              id={selection.errorId('storageKey')}
              error={selection.errors.storageKey}
              message={copy('storageKey')}
            />
          </div>
          <CatalogueSaveButton
            label={label('attach')}
            pending={selection.pending}
            disabled={false}
          />
        </fieldset>
      </form>
      {!read.loading && !read.error && !available.length && <p>{label('noFiles')}</p>}
    </div>
  );
}
