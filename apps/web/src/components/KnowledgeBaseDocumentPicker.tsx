import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  LoadingStatus,
  Button,
  Label,
  ListSearchInput,
  NativeSelect,
  buttonVariants,
} from '@barghsa/ui';
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
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
interface Props {
  attachedKeys: string[];
  headingLevel?: 2 | 3;
  disabled?: boolean;
  onDenied?: () => void;
  onAttach: (document: AvailableKnowledgeDocument, owner: RelationOwner) => void;
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
          current.current.attached !== captured.attached
        )
          return;
        const document = availableRef.current.find((row) => row.storageKey === value.storageKey);
        if (!document) return;
        const reset = () => selection.form.reset({ storageKey: '' });
        props.onAttach(document, { fields, reset, verified: reset });
      })();
    } finally {
      if (mounted.current) selection.setValidationPending(false);
    }
  }
  if (scope.denied) return <p role="alert">{label('denied')}</p>;
  const chosen = selection.values.storageKey;
  const Heading = props.headingLevel === 3 ? 'h3' : 'h2';
  const methodLink = buttonVariants({
    variant: 'ghost',
    className: 'h-auto min-h-11 min-w-0 justify-center whitespace-normal px-2 text-center',
  });
  return (
    <div className="grid min-w-0 items-start gap-4 md:grid-cols-2">
      <nav
        aria-label={copy('attachmentMethods')}
        className="grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1 md:hidden"
      >
        <a href="#kb-library-documents" className={methodLink}>
          {copy('fileLibrary')}
        </a>
        <a href="#kb-new-document-upload" className={methodLink}>
          {copy('newUploadShort')}
        </a>
      </nav>
      <section
        id="kb-library-documents"
        data-slot="knowledge-document-method"
        tabIndex={-1}
        aria-labelledby="kb-library-title"
        className={recordEditorSurface + ' flex scroll-mt-4 flex-col'}
      >
        <header className="space-y-1 border-b bg-muted/30 px-4 py-3">
          <Heading id="kb-library-title" className="text-base font-semibold">
            {copy('libraryDocuments')}
          </Heading>
          <p className="text-xs leading-relaxed text-muted-foreground">{label('pickerHelp')}</p>
        </header>
        <form
          noValidate
          className="space-y-2 px-4 pt-4"
          aria-busy={search.pending || read.loading}
          onSubmit={(event) => void submitSearch(event)}
        >
          {catalogueRootMessage(search.errors) && (
            <p role="alert">{catalogueRootMessage(search.errors)}</p>
          )}
          <fieldset
            disabled={props.disabled || search.pending || read.loading}
            className="min-w-0 space-y-1"
          >
            <Label htmlFor="kb-file-search">{label('searchFiles')}</Label>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1 basis-32">
                <ListSearchInput
                  {...search.bind('search')}
                  id="kb-file-search"
                  label={label('searchFiles')}
                  className="min-w-0"
                  value={search.values.search}
                  onChange={(event) => search.field('search')[1](event.target.value)}
                />
              </div>
              <Button type="submit" variant="outline" aria-busy={search.pending || undefined}>
                {label('search')}
              </Button>
            </div>
            <CatalogueFieldFeedback
              id={search.errorId('search')}
              error={search.errors.search}
              message={copy('search')}
              compact
            />
          </fieldset>
        </form>
        <form
          noValidate
          aria-label={label('attach')}
          className="flex flex-1 flex-col"
          aria-busy={selection.pending}
          onSubmit={(event) => void submitSelection(event)}
        >
          <div className="flex-1 space-y-3 px-4 py-4">
            {catalogueRootMessage(selection.errors) && (
              <p role="alert">{catalogueRootMessage(selection.errors)}</p>
            )}
            {read.loading && <LoadingStatus>{label('loadingFiles')}</LoadingStatus>}
            {read.error && (
              <Alert className="space-y-2" variant="warning">
                <p>{label('fileError')}</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={props.disabled}
                  onClick={read.retry}
                >
                  {label('retry')}
                </Button>
              </Alert>
            )}
            <fieldset disabled={blocked || selection.pending} className="min-w-0 space-y-1">
              <Label htmlFor="kb-file">{label('selectFile')}</Label>
              <NativeSelect
                {...selection.bind('storageKey')}
                id="kb-file"
                aria-required="true"
                className="w-full"
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
              </NativeSelect>
              <CatalogueFieldFeedback
                id={selection.errorId('storageKey')}
                error={selection.errors.storageKey}
                message={copy('storageKey')}
                compact
              />
            </fieldset>
            {!read.loading && !read.error && !available.length && (
              <p className="text-sm text-muted-foreground">{label('noFiles')}</p>
            )}
          </div>
          <RecordEditorActions>
            <CatalogueSaveButton
              label={label('attach')}
              pending={selection.pending}
              disabled={blocked || selection.pending}
            />
          </RecordEditorActions>
        </form>
      </section>
      <KnowledgeBaseUpload
        headingLevel={props.headingLevel ?? 2}
        disabled={!!props.disabled}
        attachedKeys={props.attachedKeys}
        onDenied={scope.deny}
        onAttach={props.onAttach}
      />
    </div>
  );
}
