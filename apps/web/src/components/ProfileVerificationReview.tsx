import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileUp } from 'lucide-react';
import { Alert, Button, Label, NativeSelect, Textarea } from '@barghsa/ui';
import { t } from '@barghsa/i18n/crm';
import { verificationConfigText as copy } from '@barghsa/i18n/verification-config';
import type {
  VerificationDocumentType,
  VerificationPolicy,
  VerificationProfileType,
} from '@barghsa/shared/verification';
import {
  uploadVerificationEvidence,
  isAllowedInvoiceReceiptFile,
  INVOICE_BANK_RECEIPT_FILE_ACCEPT,
} from '../lib/invoice-bank-receipt-upload.js';
import { useLocale } from '../hooks/useLocale.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
import type { TeamAction } from './TeamActionDialog.js';

type ReviewIssue =
  | { field: 'reason' | 'override' | 'upload' }
  | { field: 'document'; document: VerificationDocumentType };
type VerificationAction = 'verify' | 'unverify' | 'reverify';

export function ProfileVerificationReview({
  profileId,
  profileType,
  status,
  title,
  current,
  policy,
  canOverride,
  disabled,
  onReview,
  onPendingChange,
}: {
  profileId: string;
  profileType: VerificationProfileType;
  status: string;
  title: string;
  current: boolean;
  policy: VerificationPolicy['INDIVIDUAL'] & { allowManualOverride: boolean };
  canOverride: boolean;
  disabled: boolean;
  onReview: (action: TeamAction, summary: ReactNode) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const locale = useLocale(),
    text = (key: Parameters<typeof copy>[0]) => copy(key, locale);
  const [selected, setSelected] = useState<VerificationAction>('verify');
  const [reasons, setReasons] = useState<Partial<Record<VerificationAction, string>>>({});
  const [override, setOverride] = useState(false),
    [overrideReason, setOverrideReason] = useState('');
  const [files, setFiles] = useState<Partial<Record<VerificationDocumentType, File>>>({});
  const uploaded = useRef(new Map<File, string>()),
    live = useRef(false),
    sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<ReviewIssue | null>(null);
  const fileInputs = useRef<Partial<Record<VerificationDocumentType, HTMLInputElement>>>({});
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const overrideInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (sending.current) onPendingChange?.(false);
    };
  }, []);
  const renewal = status === 'VERIFIED' && !current;
  const choices: VerificationAction[] =
    status === 'VERIFIED'
      ? [...(renewal ? (['verify'] as const) : []), 'unverify', 'reverify']
      : ['verify'];
  const action = choices.includes(selected) ? selected : choices[0]!;
  const verifying = action === 'verify';
  const statusLabel = renewal
    ? text('expiredVerification')
    : status === 'DRAFT' || status === 'ACTIVE'
      ? text('unverifiedProfile')
      : t(`crm.list.${status}`, locale);
  const reason = reasons[action] ?? '';
  const reasonLabel = text(verifying ? 'optionalReviewNote' : 'decisionReason');
  const verificationNote =
    profileType === 'LEGAL' ? 'legalVerificationNoteExample' : 'verificationNoteExample';
  const decisionEffect = verifying
    ? ''
    : text(action === 'unverify' ? 'removeEffect' : 'recheckEffect');
  const overrideAllowed = canOverride && policy.allowManualOverride;
  const useOverride = verifying && override && overrideAllowed;
  async function review() {
    if (disabled || sending.current) return;
    if (!verifying && !reason.trim()) {
      setIssue({ field: 'reason' });
      reasonInput.current?.focus();
      return;
    }
    if (useOverride && !overrideReason.trim()) {
      setIssue({ field: 'override' });
      overrideInput.current?.focus();
      return;
    }
    const invalidFile = policy.documents.find(
      (type) => !files[type] || !isAllowedInvoiceReceiptFile(files[type]!)
    );
    if (verifying && !useOverride && invalidFile) {
      setIssue({ field: 'document', document: invalidFile });
      fileInputs.current[invalidFile]?.focus();
      return;
    }
    sending.current = true;
    onPendingChange?.(true);
    setBusy(true);
    setIssue(null);
    try {
      const evidence: { type: VerificationDocumentType; key: string }[] = [];
      if (verifying)
        for (const type of policy.documents) {
          const file = files[type];
          if (!file || useOverride) continue;
          let key = uploaded.current.get(file);
          if (!key) {
            const result = await uploadVerificationEvidence(file, profileId);
            if (!live.current) return;
            if (!result) throw new Error('Evidence upload failed');
            key = result;
            uploaded.current.set(file, key);
          }
          evidence.push({ type, key });
        }
      if (!live.current) return;
      onReview(
        {
          title:
            action === 'verify' && renewal
              ? text('renewVerification')
              : t(`crm.profile.verification.${action}`, locale),
          description: decisionEffect || text('verifyEffect'),
          path: `/api/crm/profiles/${profileId}/verify`,
          method: 'POST',
          body: {
            action,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            ...(evidence.length ? { evidence } : {}),
            ...(useOverride ? { overrideReason: overrideReason.trim() } : {}),
          },
        },
        <dl className="space-y-2 wrap-anywhere text-sm">
          <div>
            <dt className="text-muted-foreground">{t('crm.corrections.profile', locale)}</dt>
            <dd className="font-medium">
              <bdi>{title}</bdi>
            </dd>
          </div>
          {evidence.map(({ type }) => (
            <div key={type}>
              <dt className="text-muted-foreground">{text(type)}</dt>
              <dd>
                <bdi>{files[type]?.name}</bdi>
              </dd>
            </div>
          ))}
          {useOverride && (
            <div>
              <dt className="text-muted-foreground">{text('useEvidenceOverride')}</dt>
              <dd className="whitespace-pre-wrap" dir="auto">
                {overrideReason.trim()}
              </dd>
            </div>
          )}
          {!!reason.trim() && (
            <div>
              <dt className="text-muted-foreground">{reasonLabel}</dt>
              <dd className="whitespace-pre-wrap" dir="auto">
                {reason.trim()}
              </dd>
            </div>
          )}
        </dl>
      );
    } catch {
      if (live.current) setIssue({ field: 'upload' });
    } finally {
      if (live.current) {
        sending.current = false;
        onPendingChange?.(false);
        setBusy(false);
      }
    }
  }
  return (
    <form
      className={recordEditorSurface}
      aria-label={text('identityReview')}
      aria-busy={busy || undefined}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void review();
      }}
    >
      <fieldset disabled={disabled || busy} className="min-w-0">
        <div className="space-y-4 p-4 sm:p-5">
          <dl className="flex flex-wrap justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t('crm.corrections.profile', locale)}
              </dt>
              <dd className="font-semibold wrap-anywhere">
                <bdi>{title}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{text('currentVerificationStatus')}</dt>
              <dd className="font-medium">{statusLabel}</dd>
            </div>
          </dl>
          {choices.length > 1 && (
            <div className="max-w-md space-y-1.5">
              <Label htmlFor="crm-verify-action">
                {t('crm.profile.verification.action', locale)}
              </Label>
              <NativeSelect
                id="crm-verify-action"
                className="w-full bg-background"
                value={action}
                aria-describedby={decisionEffect ? 'verification-action-effect' : undefined}
                onChange={(event) => {
                  setSelected(event.target.value as VerificationAction);
                  setIssue(null);
                }}
              >
                {choices.map((value) => (
                  <option key={value} value={value}>
                    {value === 'verify' && renewal
                      ? text('renewVerification')
                      : t(`crm.profile.verification.${value}`, locale)}
                  </option>
                ))}
              </NativeSelect>
              {decisionEffect && (
                <p id="verification-action-effect" className="text-sm text-muted-foreground">
                  {decisionEffect}
                </p>
              )}
            </div>
          )}
          <div hidden={!verifying} className="space-y-3">
            {policy.documents.length > 0 && (
              <div hidden={useOverride} className="space-y-2">
                <h2 className="text-sm font-medium">{text('policyDocuments')}</h2>
                <p id="verification-evidence-formats" className="text-xs text-muted-foreground">
                  {text('evidenceFormats')}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {policy.documents.map((type) => {
                    const id = `verification-file-${type}`;
                    const file = files[type];
                    const invalid = issue?.field === 'document' && issue.document === type;
                    return (
                      <div key={type} className="min-w-0 space-y-1.5">
                        <Label htmlFor={id} id={`${id}-label`}>
                          {text(type)}
                        </Label>
                        <label className="block cursor-pointer">
                          <input
                            ref={(node) => {
                              if (node) fileInputs.current[type] = node;
                              else delete fileInputs.current[type];
                            }}
                            id={id}
                            type="file"
                            className="peer sr-only"
                            aria-labelledby={`${id}-label`}
                            aria-required={verifying && !useOverride}
                            aria-invalid={invalid || undefined}
                            aria-describedby={
                              invalid
                                ? `${id}-error verification-evidence-formats`
                                : 'verification-evidence-formats'
                            }
                            accept={INVOICE_BANK_RECEIPT_FILE_ACCEPT}
                            onChange={(event) => {
                              const selectedFile = event.currentTarget.files?.[0];
                              setFiles((current) => ({ ...current, [type]: selectedFile }));
                              if (invalid || issue?.field === 'upload') setIssue(null);
                            }}
                          />
                          <span className="flex min-h-11 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-primary hover:bg-muted/45 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary peer-aria-invalid:border-destructive peer-disabled:opacity-60">
                            <FileUp className="size-4 shrink-0" aria-hidden="true" />
                            <bdi className="min-w-0 truncate" title={file?.name}>
                              {file?.name ?? text('selectEvidence')}
                            </bdi>
                          </span>
                        </label>
                        {invalid && (
                          <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
                            {text(file ? 'invalidEvidence' : 'missingEvidence').replace(
                              '{document}',
                              text(type)
                            )}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {overrideAllowed && (
              <div className="rounded-lg border bg-muted/25 px-3 py-2">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={override}
                    className="size-4 shrink-0 accent-primary"
                    onChange={(event) => {
                      setOverride(event.target.checked);
                      setIssue(null);
                    }}
                  />
                  {text('useEvidenceOverride')}
                </label>
                {useOverride && (
                  <div className="space-y-1.5 pb-1">
                    <Label htmlFor="verification-override-reason">{text('overrideReason')}</Label>
                    <Textarea
                      ref={overrideInput}
                      id="verification-override-reason"
                      aria-required="true"
                      aria-invalid={issue?.field === 'override' || undefined}
                      aria-describedby={
                        issue?.field === 'override' ? 'verification-override-error' : undefined
                      }
                      rows={2}
                      maxLength={1000}
                      className="min-h-14 resize-y bg-background placeholder-shown:[direction:inherit]"
                      dir="auto"
                      placeholder={text('overrideExample')}
                      value={overrideReason}
                      onChange={(event) => {
                        setOverrideReason(event.target.value);
                        if (issue?.field === 'override') setIssue(null);
                      }}
                    />
                    {issue?.field === 'override' && (
                      <p
                        id="verification-override-error"
                        role="alert"
                        className="text-xs text-destructive"
                      >
                        {text('overrideRequired')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-verify-reason">{reasonLabel}</Label>
            <Textarea
              ref={reasonInput}
              id="crm-verify-reason"
              aria-required={!verifying || undefined}
              aria-invalid={issue?.field === 'reason' || undefined}
              aria-describedby={
                issue?.field === 'reason' ? 'verification-decision-error' : undefined
              }
              rows={2}
              maxLength={1000}
              placeholder={text(
                verifying
                  ? verificationNote
                  : action === 'unverify'
                    ? 'unverifyExample'
                    : 'reverifyExample'
              )}
              className="min-h-14 resize-y bg-background placeholder-shown:[direction:inherit]"
              dir="auto"
              value={reason}
              onChange={(event) => {
                const value = event.target.value;
                setReasons((current) => ({ ...current, [action]: value }));
                if (issue?.field === 'reason') setIssue(null);
              }}
            />
            {issue?.field === 'reason' && (
              <p id="verification-decision-error" role="alert" className="text-xs text-destructive">
                {text('decisionReasonRequired')}
              </p>
            )}
          </div>
          {issue?.field === 'upload' && (
            <Alert variant="destructive">{text('evidenceError')}</Alert>
          )}
        </div>
        <RecordEditorActions>
          <Button type="submit" disabled={disabled || busy} loading={busy}>
            {busy ? text('preparingEvidence') : t('crm.profile.verification.review', locale)}
          </Button>
        </RecordEditorActions>
      </fieldset>
    </form>
  );
}
