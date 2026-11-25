import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, buttonVariants, cn } from '@barghsa/ui';
import { FileText, PaperclipIcon } from 'lucide-react';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import { useLocale } from '../hooks/useLocale.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from './CatalogueEditorFeedback.js';
import type { RelationOwner } from '../lib/catalogue-membership.js';
import type { AvailableKnowledgeDocument } from '../lib/knowledge-documents.js';
import {
  RecordEditorActions,
  recordEditorSurface,
  recordFilePicker,
  recordFilePickerAction,
  recordFilePickerHelp,
} from './RecordEditorLayout.js';
import {
  KNOWLEDGE_DOCUMENT_ACCEPT,
  KnowledgeUploadDenied,
  uploadKnowledgeDocument,
  validKnowledgeDocument,
} from '../lib/knowledge-base-upload.js';

interface Props {
  headingLevel?: 2 | 3;
  disabled?: boolean;
  attachedKeys?: string[];
  onDenied?: (status: 401 | 403) => void;
  onAttach: (document: AvailableKnowledgeDocument, owner: RelationOwner) => void;
}
export function KnowledgeBaseUpload(props: Props) {
  const locale = useLocale(),
    label = (key: string) => t(`admin.kb.${key}`, locale);
  const copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
    knowledgePolicyFormText(key, locale);
  const messages = { file: copy('file') };
  const form = useWizardForm<{ file: FileList | null }>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<{ file: FileList | null }>(messages, (value) =>
        validKnowledgeDocument(value.file?.[0] ?? null) ? [] : ['file']
      );
    },
    { file: null },
    copy('unavailable')
  );
  const fields = useActionFieldErrors(form.form, messages, copy('invalid'));
  const [key, setKey] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null),
    mounted = useRef(false),
    input = useRef<HTMLInputElement | null>(null);
  const live = useRef(props);
  live.current = props;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  function reset() {
    form.form.reset({ file: null });
    if (input.current) input.current.value = '';
    setKey(null);
    setFailed(false);
  }
  const owner: RelationOwner = {
    fields: (names) =>
      names.length > 0 &&
      names.every((name) => name === 'storageKey') &&
      fields(names.map(() => 'file')),
    verified: reset,
    reset,
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (props.disabled || form.isPending() || (key && props.attachedKeys?.includes(key))) return;
    form.setValidationPending(true);
    try {
      await form.form.handleSubmit(async (value) => {
        const file = value.file?.[0];
        if (!file || !mounted.current || live.current.disabled) return;
        if (key) {
          props.onAttach({ storageKey: key, fileName: file.name }, owner);
          return;
        }
        const abort = new AbortController();
        request.current = abort;
        setFailed(false);
        try {
          const uploaded = await uploadKnowledgeDocument(file, abort.signal);
          if (!mounted.current || abort.signal.aborted) return;
          setKey(uploaded);
          if (!live.current.disabled)
            props.onAttach({ storageKey: uploaded, fileName: file.name }, owner);
        } catch (error) {
          if (!mounted.current || abort.signal.aborted) return;
          if (error instanceof KnowledgeUploadDenied) props.onDenied?.(error.status);
          else setFailed(true);
        } finally {
          if (request.current === abort) request.current = null;
        }
      })();
    } finally {
      if (mounted.current) form.setValidationPending(false);
    }
  }
  const binding = form.bind('file'),
    native = form.form.register('file'),
    root = catalogueRootMessage(form.errors);
  const selectedFile = form.values.file?.[0];
  const fileAction = copy(selectedFile ? 'changeFile' : 'chooseFile');
  const Heading = props.headingLevel === 3 ? 'h3' : 'h2';
  return (
    <form
      id="kb-new-document-upload"
      data-slot="knowledge-document-method"
      tabIndex={-1}
      noValidate
      className={recordEditorSurface + ' flex scroll-mt-4 flex-col'}
      aria-label={label('upload')}
      aria-busy={form.pending}
      onSubmit={(event) => void submit(event)}
    >
      <header className="space-y-1 border-b bg-muted/30 px-4 py-3">
        <Heading className="text-base font-semibold">{copy('newUpload')}</Heading>
      </header>
      <div className="flex-1 space-y-3 p-4">
        {root && <p role="alert">{root}</p>}
        <fieldset disabled={props.disabled || form.pending} className="min-w-0 space-y-1">
          <div className={cn(recordFilePicker, 'border-solid')}>
            <div className="relative min-w-0 max-w-full rounded-lg focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 has-[:disabled]:opacity-60">
              <span
                aria-hidden="true"
                className={buttonVariants({ variant: 'outline', className: recordFilePickerAction })}
              >
                <PaperclipIcon className="size-4 shrink-0" />
                {fileAction}
              </span>
              <input
                {...binding}
                onBlur={(event) => {
                  void native.onBlur(event);
                  void form.form.trigger('file');
                }}
                ref={(node) => {
                  input.current = node;
                  native.ref(node);
                }}
                id="kb-new-document"
                type="file"
                aria-label={fileAction}
                aria-required="true"
                accept={KNOWLEDGE_DOCUMENT_ACCEPT}
                aria-describedby={[
                  binding['aria-describedby'],
                  'kb-upload-help',
                  selectedFile && 'kb-upload-selection',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onChange={(event) => {
                  void native.onChange(event);
                  setKey(null);
                  setFailed(false);
                }}
                className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              />
            </div>
            <p id="kb-upload-help" className={recordFilePickerHelp}>
              {label('uploadHelp')}
            </p>
          </div>
          {selectedFile && (
            <p
              id="kb-upload-selection"
              className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm [overflow-wrap:anywhere]"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <bdi className="min-w-0">{selectedFile.name}</bdi>
            </p>
          )}
          <CatalogueFieldFeedback
            id={form.errorId('file')}
            error={form.errors.file}
            message={messages.file}
            compact
          />
        </fieldset>
        {key && (
          <p role="status" className="text-sm text-muted-foreground">
            {label('uploaded')}
          </p>
        )}
        {failed && <Alert variant="destructive">{label('uploadError')}</Alert>}
        {form.pending && (
          <p role="status" className="text-sm text-muted-foreground">
            {label('uploading')}
          </p>
        )}
      </div>
      <RecordEditorActions>
        <CatalogueSaveButton
          label={label(key ? 'attachUploaded' : 'upload')}
          pending={form.pending}
          disabled={
            !!props.disabled || form.pending || (!!key && !!props.attachedKeys?.includes(key))
          }
        />
      </RecordEditorActions>
    </form>
  );
}
