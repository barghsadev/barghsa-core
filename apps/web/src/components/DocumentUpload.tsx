import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  NativeSelect,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import {
  documentBase,
  documentRequest,
  putDocumentFile,
  DocumentRequestError,
  type BusinessDocument,
  type DocumentUpload as Upload,
} from '../lib/documents.js';

type Attempt = { upload: Upload; file: File; uploaded: boolean; confirmKey: string };
export function DocumentUpload({
  staff,
  profileId,
  replacement,
  onClose,
  onUploaded,
}: {
  staff: boolean;
  profileId: string;
  replacement: BusinessDocument | null;
  onClose: () => void;
  onUploaded: (document: BusinessDocument) => void;
}) {
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('document');
  const [action, setAction] = useState<TeamAction | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'confirming' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState(false);
  const controller = useRef(new AbortController());
  const busy = useRef(false);
  useEffect(() => {
    // A profile change or closing the form abandons this in-memory file and request.
    const active = new AbortController();
    controller.current = active;
    return () => active.abort();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !file.size || file.size > 50 * 1024 * 1024) {
      setError(word('invalidFile'));
      return;
    }
    if (!replacement && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(profileId)) {
      setError(word('invalidReference'));
      return;
    }
    setError(null);
    const context = replacement
      ? {
          profileId: replacement.profileId,
          businessRecordType: replacement.businessRecordType,
          ...(replacement.businessRecordId
            ? { businessRecordId: replacement.businessRecordId }
            : {}),
          ...(replacement.contractVersionId
            ? {
                contractVersionId: replacement.contractVersionId,
                contractRole: replacement.contractRole,
              }
            : {}),
          supersedesDocumentId: replacement.id,
        }
      : { businessRecordType: 'standalone', profileId };
    setAction({
      title: word(replacement ? 'replace' : 'upload'),
      description: file.name,
      path: documentBase(staff),
      method: 'POST',
      body: {
        ...context,
        category: replacement?.category ?? category,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || 'application/octet-stream',
        idempotencyKey: crypto.randomUUID(),
      },
      conflictMessage: word('conflict'),
      forbiddenMessage: word('denied'),
    });
  }
  async function continueUpload(current: Attempt) {
    if (busy.current || controller.current.signal.aborted) return;
    busy.current = true;
    setError(null);
    try {
      if (!current.uploaded) {
        setPhase('uploading');
        await putDocumentFile(current.upload.upload, current.file, controller.current.signal);
        current.uploaded = true;
      }
      setPhase('confirming');
      const document = await documentRequest<BusinessDocument>(
        `${documentBase(staff)}/${current.upload.document.id}/confirm`,
        {
          method: 'POST',
          signal: controller.current.signal,
          body: JSON.stringify({ expectedRevision: 1, idempotencyKey: current.confirmKey }),
        }
      );
      if (!controller.current.signal.aborted) onUploaded(document);
    } catch (failure) {
      if (!controller.current.signal.aborted) {
        setPhase('failed');
        if (
          failure instanceof DocumentRequestError &&
          failure.code === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code
        )
          setVerification(true);
        else setError(word('uploadFailed'));
      }
    } finally {
      busy.current = false;
    }
  }
  const inProgress = phase === 'uploading' || phase === 'confirming';
  return (
    <section
      className="flex flex-col gap-4 rounded-xl border bg-card p-5"
      aria-label={word(replacement ? 'replace' : 'upload')}
    >
      <h2 className="text-xl font-semibold">{word(replacement ? 'replace' : 'upload')}</h2>
      {replacement ? <p className="break-words text-sm">{replacement.originalName}</p> : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {attempt ? (
        <>
          <p role="status">{word(inProgress ? phase : 'uploadFailed')}</p>
          {phase === 'failed' ? (
            <Button onClick={() => void continueUpload(attempt)}>{word('retryUpload')}</Button>
          ) : null}
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup>
            {!replacement ? (
              <Field>
                <FieldLabel htmlFor="document-category">{word('category')}</FieldLabel>
                <NativeSelect
                  id="document-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="document">{word('document')}</option>
                  <option value="image">{word('image')}</option>
                </NativeSelect>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="document-file">{word('file')}</FieldLabel>
              <Input
                id="document-file"
                type="file"
                disabled={!!action}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Field>
          </FieldGroup>
          <Button type="submit" disabled={!file || !!action}>
            {word(replacement ? 'replace' : 'upload')}
          </Button>
        </form>
      )}
      <Button variant="ghost" onClick={onClose} disabled={inProgress}>
        {word('cancel')}
      </Button>
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            const current: Attempt = {
              upload: result as Upload,
              file: file!,
              uploaded: false,
              confirmKey: crypto.randomUUID(),
            };
            setAction(null);
            setAttempt(current);
            await continueUpload(current);
          }}
        />
      ) : null}
      {verification && attempt ? (
        <TeamActionDialog
          verification={{ title: word('password'), description: word('passwordHint') }}
          onClose={() => setVerification(false)}
          onSuccess={async () => {
            setVerification(false);
            await continueUpload(attempt);
          }}
        />
      ) : null}
    </section>
  );
}
