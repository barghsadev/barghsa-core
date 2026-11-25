import { confirmationText } from '@barghsa/i18n/confirmation';
import { toast } from '../lib/toast-api.js';
import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { RecordCommandGuard } from './RecordCommandGuard.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Alert, AlertDescription, Button, Field, FieldLabel, NativeSelect } from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useLocale } from '../hooks/useLocale.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { FileUpload } from './FileUpload.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
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
  association?:
    ContractDocumentAssociation | OrderDocumentAssociation | SolarDocumentAssociation | undefined;
  imageOnly?: boolean;
  recordPage?: boolean;
  recordTitle?: string;
  recordContext?: ReactNode;
  recordHeadingRef?: RefObject<HTMLHeadingElement | null>;
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
  recordPage = false,
  recordTitle,
  recordContext,
  recordHeadingRef,
  onClose,
  onUploaded,
}: DocumentUploadProps) {
  const locale = useLocale(),
    word = (key: string) => documentText(key, locale);
  const headingId = useId();
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
    busy = useRef(false),
    leaving = useRef(false);
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
    if (denied || action || attempt || !file || !policy || validateUploadFiles([file], policy, 1))
      return;
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
      title: recordTitle ?? word(replacement ? 'replace' : 'upload'),
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
      if (!active.signal.aborted && mounted.current && controller.current === active) {
        if (
          !document ||
          document.id !== current.upload.document.id ||
          document.profileId !== current.upload.document.profileId ||
          !matchesAttachment(document) ||
          !['Available', 'PendingScan'].includes(document.state) ||
          !Number.isInteger(document.revision) ||
          document.revision <= current.upload.document.revision
        )
          throw new Error('Document sealing receipt mismatch');
        leaving.current = true;
        toast.success(
          recordPage
            ? word(document.state === 'PendingScan' ? 'PendingScan' : 'uploadComplete')
            : confirmationText('recorded', locale)
        );
        onUploaded(document);
      }
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
    leaving.current = true;
    mounted.current = false;
    controller.current?.abort();
    setAction(null);
    onClose();
  }
  const inProgress = phase === 'uploading' || phase === 'confirming';
  const selected = attempt?.file ?? file;
  const submitLabel = word(replacement ? 'replace' : 'upload');
  const title = recordTitle ?? submitLabel;
  const Heading = recordPage ? 'h1' : 'h2';
  function matchesAttachment(document: BusinessDocument | undefined) {
    if (
      association?.businessRecordType !== 'contract' &&
      association?.businessRecordType !== 'solar_request' &&
      !(recordPage && association?.businessRecordType === 'order')
    )
      return true;
    if (
      document?.profileId !== profileId ||
      document.businessRecordType !== association.businessRecordType ||
      document.businessRecordId !== association.businessRecordId
    )
      return false;
    return association.businessRecordType === 'contract'
      ? document.contractVersionId === association.contractVersionId &&
          document.contractRole === association.contractRole &&
          (!replacement ||
            (document.supersedesDocumentId === replacement.id &&
              document.category === effectiveCategory &&
              document.uploadedByType === (staff ? 'staff' : 'customer')))
      : document.category === effectiveCategory &&
          document.uploadedByType === (staff ? 'staff' : 'customer') &&
          (!replacement || document.supersedesDocumentId === replacement.id);
  }
  return (
    <section className={recordEditorSurface} aria-labelledby={headingId}>
      {recordPage && (
        <RecordCommandGuard
          blocked={() => !leaving.current && (!!action || !!attempt || busy.current)}
        />
      )}
      <header className="space-y-1 border-b px-4 py-4 sm:px-6">
        <Heading
          id={headingId}
          ref={recordHeadingRef}
          data-slot={recordHeadingRef ? 'editor-heading' : undefined}
          tabIndex={recordHeadingRef ? -1 : undefined}
          className={recordPage ? 'text-2xl font-semibold outline-none!' : 'text-lg font-semibold'}
        >
          {title}
        </Heading>
        {!denied && !replacement && !association && (
          <p className="text-sm text-muted-foreground">{word('uploadAfterReview')}</p>
        )}
        {!denied && recordContext}
      </header>
      <form onSubmit={submit}>
        <div className="space-y-4 px-4 py-4 sm:px-6">
          {!denied && replacement && (
            <div className="space-y-1 rounded-lg border bg-muted/30 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">{word('replacingFile')}</p>
              <p className="text-sm font-medium [overflow-wrap:anywhere]">
                <bdi>{replacement.originalName}</bdi>
              </p>
              {replacement.state === 'Rejected' && replacement.rejectionReason && (
                <p dir="auto" className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {replacement.rejectionReason}
                </p>
              )}
            </div>
          )}
          {!denied && staff && recordPage && !replacement && !association && (
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
              <span>{word('profile')}</span>
              <bdi className="font-medium text-foreground [overflow-wrap:anywhere]">
                {profileId}
              </bdi>
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {policyError && (
            <Alert variant="destructive" className="space-y-2">
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
            <>
              {!attempt &&
                !replacement &&
                association?.businessRecordType !== 'contract' &&
                !imageOnly && (
                  <Field className="max-w-xs gap-1.5">
                    <FieldLabel htmlFor="document-category">{word('category')}</FieldLabel>
                    <NativeSelect
                      id="document-category"
                      className="w-full"
                      value={category}
                      disabled={!!action}
                      onChange={(event) => setCategory(event.target.value)}
                    >
                      <option value="document">{word('document')}</option>
                      <option value="image">{word('image')}</option>
                      <option value="video">{word('video')}</option>
                    </NativeSelect>
                  </Field>
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
            </>
          )}
        </div>
        <RecordEditorActions
          secondary={
            <Button type="button" variant="ghost" onClick={close}>
              {word(attempt ? 'closeUpload' : 'cancel')}
            </Button>
          }
        >
          {!denied && !attempt && (
            <Button
              type="submit"
              disabled={
                !file || !policy || !!action || !!validateUploadFiles(file ? [file] : [], policy, 1)
              }
            >
              {submitLabel}
            </Button>
          )}
          {!denied && attempt && inProgress && (
            <Button type="button" variant="outline" onClick={pause}>
              {word('pauseUpload')}
            </Button>
          )}
          {!denied && attempt && (phase === 'failed' || phase === 'paused') && (
            <Button type="button" onClick={() => void continueUpload(attempt)}>
              {word(phase === 'paused' ? 'resumeUpload' : 'retryUpload')}
            </Button>
          )}
        </RecordEditorActions>
      </form>
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            if (!mounted.current || denied) return;
            const reserved = result as Upload;
            if (!matchesAttachment(reserved?.document))
              throw new Error('Document reservation mismatch');
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
