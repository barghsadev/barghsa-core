import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Input, Label } from '@barghsa/ui';
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
import {
  KNOWLEDGE_DOCUMENT_ACCEPT,
  KnowledgeUploadDenied,
  uploadKnowledgeDocument,
  validKnowledgeDocument,
} from '../lib/knowledge-base-upload.js';

interface Props {
  disabled?: boolean;
  attachedKeys?: string[];
  onDenied?: (status: 401 | 403) => void;
  onAttach: (key: string, owner: RelationOwner) => void;
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
          props.onAttach(key, owner);
          return;
        }
        const abort = new AbortController();
        request.current = abort;
        setFailed(false);
        try {
          const uploaded = await uploadKnowledgeDocument(file, abort.signal);
          if (!mounted.current || abort.signal.aborted) return;
          setKey(uploaded);
          if (!live.current.disabled) props.onAttach(uploaded, owner);
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
  return (
    <form
      noValidate
      className="flex flex-col gap-3 border-b pb-4"
      aria-label={label('upload')}
      aria-busy={form.pending}
      onSubmit={(event) => void submit(event)}
    >
      {root && <p role="alert">{root}</p>}
      <fieldset disabled={props.disabled || form.pending} className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="kb-new-document">{label('newDocument')}</Label>
          <Input
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
            accept={KNOWLEDGE_DOCUMENT_ACCEPT}
            aria-describedby={[binding['aria-describedby'], 'kb-upload-help']
              .filter(Boolean)
              .join(' ')}
            onChange={(event) => {
              void native.onChange(event);
              setKey(null);
              setFailed(false);
            }}
          />
          <p id="kb-upload-help" className="text-sm text-muted-foreground">
            {label('uploadHelp')}
          </p>
          <CatalogueFieldFeedback
            id={form.errorId('file')}
            error={form.errors.file}
            message={messages.file}
          />
        </div>
        <div>
          <CatalogueSaveButton
            label={label(key ? 'attachUploaded' : 'upload')}
            pending={form.pending}
            disabled={!!key && !!props.attachedKeys?.includes(key)}
          />
        </div>
      </fieldset>
      {key && <p role="status">{label('uploaded')}</p>}
      {failed && <p role="alert">{label('uploadError')}</p>}
      {form.pending && <p role="status">{label('uploading')}</p>}
    </form>
  );
}
