import { useEffect, useRef, useState } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
import {
  KNOWLEDGE_DOCUMENT_ACCEPT,
  uploadKnowledgeDocument,
} from '../lib/knowledge-base-upload.js';

export function KnowledgeBaseUpload({ onAttach }: { onAttach: (key: string) => void }) {
  const locale = useLocale(),
    label = (key: string) => t(`admin.kb.${key}`, locale);
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'uploading' | 'uploaded' | 'error'>('idle');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  return (
    <form
      className="flex flex-col gap-3 border-b pb-4"
      aria-label={label('upload')}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!file || request.current) return;
        if (key) {
          onAttach(key);
          return;
        }
        const abort = new AbortController();
        request.current = abort;
        setState('uploading');
        try {
          const uploaded = await uploadKnowledgeDocument(file, abort.signal);
          if (!abort.signal.aborted) {
            setKey(uploaded);
            setState('uploaded');
            onAttach(uploaded);
          }
        } catch {
          if (!abort.signal.aborted) setState('error');
        } finally {
          if (request.current === abort) request.current = null;
        }
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="kb-new-document">{label('newDocument')}</Label>
        <Input
          id="kb-new-document"
          type="file"
          accept={KNOWLEDGE_DOCUMENT_ACCEPT}
          disabled={state === 'uploading'}
          aria-describedby="kb-upload-help"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setKey(null);
            setState('idle');
          }}
        />
        <p id="kb-upload-help" className="text-sm text-muted-foreground">
          {label('uploadHelp')}
        </p>
      </div>
      <div>
        <Button type="submit" disabled={!file || state === 'uploading'}>
          {label(key ? 'attachUploaded' : state === 'uploading' ? 'uploading' : 'upload')}
        </Button>
      </div>
      {state === 'uploaded' && <p role="status">{label('uploaded')}</p>}
      {state === 'error' && <p role="alert">{label('uploadError')}</p>}
      {state === 'uploading' && <p role="status">{label('uploading')}</p>}
    </form>
  );
}
