import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n/crm';
import { verificationConfigText as copy } from '@barghsa/i18n/verification-config';
import type { VerificationDocumentType, VerificationPolicy } from '@barghsa/shared/verification';
import {
  uploadVerificationEvidence,
  isAllowedInvoiceReceiptFile,
  INVOICE_BANK_RECEIPT_FILE_ACCEPT,
} from '../lib/invoice-bank-receipt-upload.js';
import { useLocale } from '../hooks/useLocale.js';
import type { TeamAction } from './TeamActionDialog.js';

export function ProfileVerificationReview({
  profileId,
  status,
  title,
  current,
  policy,
  canOverride,
  disabled,
  onReview,
}: {
  profileId: string;
  status: string;
  title: string;
  current: boolean;
  policy: VerificationPolicy['INDIVIDUAL'] & { allowManualOverride: boolean };
  canOverride: boolean;
  disabled: boolean;
  onReview: (action: TeamAction) => void;
}) {
  const locale = useLocale(),
    text = (key: Parameters<typeof copy>[0]) => copy(key, locale);
  const [selected, setSelected] = useState('verify'),
    [reason, setReason] = useState('');
  const [override, setOverride] = useState(false),
    [overrideReason, setOverrideReason] = useState('');
  const [files, setFiles] = useState<Partial<Record<VerificationDocumentType, File>>>({});
  const uploaded = useRef(new Map<File, string>()),
    live = useRef(false),
    sending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const fileInputs = useRef<Partial<Record<VerificationDocumentType, HTMLInputElement>>>({});
  const overrideInput = useRef<HTMLTextAreaElement>(null);
  const [invalidDocument, setInvalidDocument] = useState<VerificationDocumentType | null>(null);
  const [invalidOverride, setInvalidOverride] = useState(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const renewal = status === 'VERIFIED' && !current;
  const choices =
    status === 'VERIFIED' ? [...(renewal ? ['verify'] : []), 'unverify', 'reverify'] : ['verify'];
  const action = choices.includes(selected) ? selected : choices[0]!;
  async function review() {
    if (disabled || sending.current) return;
    const useOverride =
      action === 'verify' && override && canOverride && policy.allowManualOverride;
    if ((action !== 'verify' && !reason.trim()) || (useOverride && !overrideReason.trim())) {
      setError(true);
      if (useOverride) {
        setInvalidOverride(true);
        overrideInput.current?.focus();
      }
      return;
    }
    const invalidFile = policy.documents.find(
      (type) => !files[type] || !isAllowedInvoiceReceiptFile(files[type]!)
    );
    if (action === 'verify' && !useOverride && invalidFile) {
      setError(true);
      setInvalidDocument(invalidFile);
      fileInputs.current[invalidFile]?.focus();
      return;
    }
    sending.current = true;
    setBusy(true);
    setError(false);
    try {
      const evidence: { type: VerificationDocumentType; key: string }[] = [];
      if (action === 'verify')
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
      onReview({
        title: t(`crm.profile.verification.${action}`, locale),
        description: `${title} · ${reason.trim()}`,
        path: `/api/crm/profiles/${profileId}/verify`,
        method: 'POST',
        body: {
          action,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(evidence.length ? { evidence } : {}),
          ...(useOverride ? { overrideReason: overrideReason.trim() } : {}),
        },
      });
    } catch {
      if (live.current) setError(true);
    } finally {
      if (live.current) {
        sending.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <fieldset
      className="mb-4 min-w-0 space-y-3 rounded border bg-card text-card-foreground p-4"
      disabled={disabled || busy}
    >
      <Label htmlFor="crm-verify-action">{t('crm.profile.verification.action', locale)}</Label>
      <select
        id="crm-verify-action"
        className="block rounded border border-input bg-background p-2"
        value={action}
        onChange={(e) => {
          setSelected(e.target.value);
          setError(false);
        }}
      >
        {choices.map((value) => (
          <option key={value} value={value}>
            {value === 'verify' && renewal
              ? text('renewVerification')
              : t(`crm.profile.verification.${value}`, locale)}
          </option>
        ))}
      </select>
      <Label htmlFor="crm-verify-reason">{t('crm.profile.verification.reason', locale)}</Label>
      <textarea
        id="crm-verify-reason"
        aria-required={action !== 'verify' || undefined}
        className="block w-full rounded border bg-background p-2"
        maxLength={1000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {action === 'verify' && (
        <>
          {policy.documents.map((type) => (
            <div key={type} className="space-y-2">
              <Label htmlFor={`verification-file-${type}`}>{text(type)}</Label>
              <input
                ref={(node) => {
                  if (node) fileInputs.current[type] = node;
                  else delete fileInputs.current[type];
                }}
                id={`verification-file-${type}`}
                type="file"
                aria-required={!override || !canOverride || !policy.allowManualOverride}
                aria-invalid={invalidDocument === type || undefined}
                aria-describedby={
                  invalidDocument === type ? 'verification-review-error' : undefined
                }
                className="block max-w-full"
                accept={INVOICE_BANK_RECEIPT_FILE_ACCEPT}
                onChange={(e) => {
                  setFiles({ ...files, [type]: e.target.files?.[0] });
                  setError(false);
                  setInvalidDocument(null);
                }}
              />
            </div>
          ))}
          {canOverride && policy.allowManualOverride && (
            <>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(e) => {
                    setOverride(e.target.checked);
                    setInvalidDocument(null);
                    setInvalidOverride(false);
                    setError(false);
                  }}
                />
                {text('policyOverride')}
              </label>
              {override && (
                <>
                  <Label htmlFor="verification-override-reason">{text('overrideReason')}</Label>
                  <textarea
                    ref={overrideInput}
                    id="verification-override-reason"
                    aria-required="true"
                    aria-invalid={invalidOverride || undefined}
                    aria-describedby={invalidOverride ? 'verification-review-error' : undefined}
                    maxLength={1000}
                    className="block w-full rounded border bg-background p-2"
                    value={overrideReason}
                    onChange={(e) => {
                      setOverrideReason(e.target.value);
                      setInvalidOverride(false);
                      setError(false);
                    }}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <Alert id="verification-review-error" variant="destructive">
          {invalidDocument
            ? `${text('policyDocuments')}: ${text(invalidDocument)}`
            : invalidOverride
              ? text('overrideReason')
              : text('evidenceError')}
        </Alert>
      )}
      <Button
        type="button"
        disabled={action !== 'verify' && !reason.trim()}
        onClick={() => void review()}
      >
        {busy ? text('saving') : t('crm.profile.verification.review', locale)}
      </Button>
    </fieldset>
  );
}
