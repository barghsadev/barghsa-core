import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  NativeSelect,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useLocale } from '../hooks/useLocale.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { FileUpload } from './FileUpload.js';
import {
  readFileUploadPolicy,
  validateUploadFiles,
  uploadContentType,
  type FileUploadPolicy,
} from '../lib/file-upload.js';
import {
  documentBase,
  documentRequest,
  putDocumentFile,
  DocumentRequestError,
  type BusinessDocument,
  type DocumentUpload as Upload,
} from '../lib/documents.js';
export interface ContractDocumentAssociation {
  businessRecordType: 'contract';
  businessRecordId: string;
  contractVersionId: string;
  contractRole: 'original' | 'signed' | 'amendment';
}
export interface OrderDocumentAssociation {
  businessRecordType: 'order';
  businessRecordId: string;
}
export interface SolarDocumentAssociation {
  businessRecordType: 'solar_request';
  businessRecordId: string;
}
type Attempt = { upload: Upload; file: File; uploaded: boolean; confirmKey: string };
interface DocumentUploadProps {
  staff: boolean;
  profileId: string;
  replacement: BusinessDocument | null;
  association?: ContractDocumentAssociation | OrderDocumentAssociation | SolarDocumentAssociation;
  imageOnly?: boolean;
  onClose: () => void;
  onUploaded: (document: BusinessDocument) => void;
}

export function DocumentUpload(props: DocumentUploadProps) {
  const revision = useProfileContextRevision(),
    association = props.association;
  const actor = useAccountUser();
  const scope = JSON.stringify([
    props.staff,
    props.profileId,
    props.replacement?.id,
    props.replacement?.revision,
    association?.businessRecordType,
    association?.businessRecordId,
    association?.businessRecordType === 'contract' ? association.contractVersionId : null,
    association?.businessRecordType === 'contract' ? association.contractRole : null,
    props.imageOnly,
    revision,
    actor,
  ]);
  return <UploadForm key={scope} {...props} />;
}
function UploadForm({
  staff,
  profileId,
  replacement,
  association,
  imageOnly = false,
  onClose,
  onUploaded,
}: DocumentUploadProps) {
  const locale = useLocale(),
    word = (key: string) => documentText(key, locale);
  const [file, setFile] = useState<File | null>(null),
    [category, setCategory] = useState(imageOnly ? 'image' : 'document');
  const [action, setAction] = useState<TeamAction | null>(null),
    [attempt, setAttempt] = useState<Attempt | null>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'confirming' | 'failed' | 'paused'>(
    'idle'
  );
  const [loaded, setLoaded] = useState(0),
    [error, setError] = useState<string | null>(null),
    [verification, setVerification] = useState(false);
  const [policyState, setPolicyState] = useState<{
    category: string;
    value: FileUploadPolicy;
  } | null>(null);
  const [policyError, setPolicyError] = useState(false),
    [policyRetry, setPolicyRetry] = useState(0),
    [denied, setDenied] = useState(false);
  const effectiveCategory =
    replacement?.category ??
    (association?.businessRecordType === 'contract' ? 'contract' : category);
  const policy = policyState?.category === effectiveCategory ? policyState.value : null;
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readDocument = useOwnedDocumentRead(
    actor,
    revision,
    staff,
    profileId,
    JSON.stringify([effectiveCategory, imageOnly])
  );
  const controller = useRef<AbortController | null>(null),
    mounted = useRef(false),
    busy = useRef(false);
  const denyPreview = useCallback(() => {
    controller.current?.abort();
    setFile(null);
    setAttempt(null);
    setAction(null);
    setVerification(false);
    setDenied(true);
    setPolicyError(true);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const read = new AbortController();
    setPolicyError(false);
    setPolicyState(null);
    void readDocument<unknown>(`/api/upload/policy/${encodeURIComponent(effectiveCategory)}`, {
      signal: read.signal,
    })
      .then((raw) => {
        if (read.signal.aborted) return;
        const parsed = readFileUploadPolicy(raw);
        if (!parsed) throw new DocumentRequestError(502, null);
        const value = {
          ...parsed,
          maxSizeBytes: Math.min(parsed.maxSizeBytes, 50 * 1024 * 1024),
          formats: imageOnly
            ? parsed.formats.filter((format) =>
                format.mimeTypes.every((mime) => mime.startsWith('image/'))
              )
            : parsed.formats,
        };
        setPolicyState({ category: effectiveCategory, value });
        setDenied(false);
      })
      .catch((reason: unknown) => {
        if (read.signal.aborted) return;
        if (reason instanceof DocumentRequestError && [401, 403].includes(reason.status)) {
          controller.current?.abort();
          setFile(null);
          setAttempt(null);
          setAction(null);
          setVerification(false);
          setDenied(true);
        }
        setPolicyError(true);
      });
    return () => read.abort();
  }, [effectiveCategory, policyRetry, imageOnly, readDocument]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !policy || validateUploadFiles([file], policy, 1)) return;
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
      : { ...(association ?? { businessRecordType: 'standalone' }), profileId };
    setAction({
      title: word(replacement ? 'replace' : 'upload'),
      description: file.name,
      path: documentBase(staff),
      method: 'POST',
      body: {
        ...context,
        category: effectiveCategory,
        fileName: file.name,
        fileSize: file.size,
        contentType: uploadContentType(file, policy)!,
        idempotencyKey: crypto.randomUUID(),
      },
      conflictMessage: word('conflict'),
      forbiddenMessage: word('denied'),
    });
  }
  async function continueUpload(current: Attempt) {
    if (busy.current || !mounted.current || denied) return;
    busy.current = true;
    const active = new AbortController();
    controller.current = active;
    setError(null);
    try {
      if (!current.uploaded) {
        setPhase('uploading');
        await putDocumentFile(
          current.upload.upload,
          current.file,
          active.signal,
          (bytes, total) => {
            if (!mounted.current || active.signal.aborted || controller.current !== active) return;
            setLoaded((previous) =>
              Math.floor((previous / total) * 100) === Math.floor((bytes / total) * 100)
                ? previous
                : bytes
            );
          }
        );
        current.uploaded = true;
      }
      if (active.signal.aborted || !mounted.current) return;
      setLoaded(current.file.size);
      setPhase('confirming');
      const document = await documentRequest<BusinessDocument>(
        `${documentBase(staff)}/${current.upload.document.id}/confirm`,
        {
          method: 'POST',
          signal: active.signal,
          body: JSON.stringify({ expectedRevision: 1, idempotencyKey: current.confirmKey }),
        }
      );
      if (!active.signal.aborted && mounted.current && controller.current === active)
        onUploaded(document);
    } catch (failure) {
      if (!active.signal.aborted && mounted.current && controller.current === active) {
        setPhase('failed');
        if (
          failure instanceof DocumentRequestError &&
          failure.code === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code
        )
          setVerification(true);
        else if (failure instanceof DocumentRequestError && [401, 403].includes(failure.status)) {
          setDenied(true);
          setFile(null);
          setAttempt(null);
          setVerification(false);
          setError(word('denied'));
        } else setError(word('uploadFailed'));
      }
    } finally {
      if (controller.current === active) busy.current = false;
    }
  }
  function pause() {
    controller.current?.abort();
    busy.current = false;
    setVerification(false);
    setPhase('paused');
  }
  function close() {
    mounted.current = false;
    controller.current?.abort();
    setAction(null);
    onClose();
  }
  const inProgress = phase === 'uploading' || phase === 'confirming';
  const selected = attempt?.file ?? file;
  return (
    <section
      className="flex flex-col gap-4 rounded-xl border bg-card p-5"
      aria-label={word(replacement ? 'replace' : 'upload')}
    >
      <h2 className="text-xl font-semibold">{word(replacement ? 'replace' : 'upload')}</h2>
      {!denied && replacement && <p className="break-words text-sm">{replacement.originalName}</p>}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {policyError && (
        <Alert variant="destructive">
          <AlertDescription>{word(denied ? 'denied' : 'policyError')}</AlertDescription>
          {!denied && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setPolicyRetry((value) => value + 1)}
            >
              {word('retry')}
            </Button>
          )}
        </Alert>
      )}
      {!denied && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {!attempt &&
            !replacement &&
            association?.businessRecordType !== 'contract' &&
            !imageOnly && (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="document-category">{word('category')}</FieldLabel>
                  <NativeSelect
                    id="document-category"
                    value={category}
                    disabled={!!action}
                    onChange={(event) => setCategory(event.target.value)}
                  >
                    <option value="document">{word('document')}</option>
                    <option value="image">{word('image')}</option>
                    <option value="video">{word('video')}</option>
                  </NativeSelect>
                </Field>
              </FieldGroup>
            )}
          <FileUpload
            value={selected ? [selected] : []}
            onChange={(files) => {
              setFile(files[0] ?? null);
              setError(null);
            }}
            policy={policy}
            locale={locale}
            disabled={!!attempt || !!action}
            onAccessDenied={denyPreview}
            {...(attempt && phase !== 'idle'
              ? { progress: [{ file: attempt.file, loaded, total: attempt.file.size, phase }] }
              : {})}
          />
          {!attempt && (
            <Button
              type="submit"
              disabled={
                !file || !policy || !!action || !!validateUploadFiles(file ? [file] : [], policy, 1)
              }
            >
              {word(replacement ? 'replace' : 'upload')}
            </Button>
          )}
        </form>
      )}
      {!denied && attempt && (
        <>
          {inProgress && (
            <Button type="button" variant="outline" onClick={pause}>
              {word('pauseUpload')}
            </Button>
          )}
          {(phase === 'failed' || phase === 'paused') && (
            <Button type="button" onClick={() => void continueUpload(attempt)}>
              {word(phase === 'paused' ? 'resumeUpload' : 'retryUpload')}
            </Button>
          )}
        </>
      )}
      <Button type="button" variant="ghost" onClick={close}>
        {word(attempt ? 'closeUpload' : 'cancel')}
      </Button>
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            if (!mounted.current || denied) return;
            const reserved = result as Upload;
            const contentType = policy && file ? uploadContentType(file, policy) : null;
            const upload =
              'presignedUrl' in reserved.upload &&
              contentType &&
              !Object.keys(reserved.upload.headers).some(
                (name) => name.toLowerCase() === 'content-type'
              )
                ? {
                    ...reserved,
                    upload: {
                      ...reserved.upload,
                      headers: { ...reserved.upload.headers, 'Content-Type': contentType },
                    },
                  }
                : reserved;
            const current: Attempt = {
              upload,
              file: file!,
              uploaded: false,
              confirmKey: crypto.randomUUID(),
            };
            setAction(null);
            setAttempt(current);
            await continueUpload(current);
          }}
        />
      )}
      {verification && attempt && (
        <TeamActionDialog
          verification={{ title: word('verificationTitle'), description: word('passwordHint') }}
          onClose={() => setVerification(false)}
          onSuccess={async () => {
            setVerification(false);
            await continueUpload(attempt);
          }}
        />
      )}
    </section>
  );
}
