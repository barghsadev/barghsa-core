import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n/recovery';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { uploadVerificationEvidence } from '../lib/invoice-bank-receipt-upload.js';
interface RecoveryAction extends TeamAction {
  expectedState?: string;
  codeReceipt?: boolean;
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
interface RecoveryCase {
  id: string;
  profileId: string;
  targetUserId: string;
  oldLogin: string;
  newLogin: string;
  state: string;
  createdBy: string;
  reviewedBy: string | null;
  supportReference: string;
  reason: string;
  reviewerNotes: string | null;
  challengeId: string | null;
  contactVerified: boolean;
  evidenceDownloadUrls: string[];
  history: Array<{
    event: string;
    created_at: string;
    user_id: string;
    metadata: string;
    correlation_id: string;
  }>;
}
function valid(value: unknown): value is RecoveryCase {
  if (typeof value !== 'object' || !value) return false;
  const row = value as RecoveryCase;
  return (
    ['id', 'profileId', 'targetUserId', 'oldLogin', 'newLogin', 'createdBy'].every(
      (k) => typeof row[k as keyof RecoveryCase] === 'string'
    ) &&
    ['open', 'approved', 'rejected', 'applied', 'completed'].includes(row.state) &&
    typeof row.contactVerified === 'boolean' &&
    (row.challengeId === null || typeof row.challengeId === 'string') &&
    Array.isArray(row.evidenceDownloadUrls) &&
    row.evidenceDownloadUrls.every((x) => typeof x === 'string') &&
    Array.isArray(row.history) &&
    row.history.every((x) => typeof x.event === 'string' && typeof x.created_at === 'string')
  );
}
export default function AccountRecoveryPage() {
  const actor = useAccountUser(),
    revision = useProfileContextRevision();
  return <RecoveryWorkflow key={JSON.stringify([actor, revision])} actor={actor} />;
}
function RecoveryWorkflow({ actor }: { actor: string | null }) {
  const locale = useLocale();
  const [draft, setDraft] = useState({
    profileId: '',
    newLogin: '',
    supportReference: '',
    reason: '',
  });
  const [caseId, setCaseId] = useState(''),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]),
    [notes, setNotes] = useState('');
  const [notices, setNotices] = useState({ oldContact: '', newContact: '' });
  const [action, setAction] = useState<RecoveryAction | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const mounted = useRef(true),
    inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const denied = useCallback(() => {
    setAction(null);
    setSelectedId(null);
  }, []);
  const scope = useCatalogueScope(denied);
  const read = useCatalogueResource(
    scope,
    selectedId ? `/api/crm/account-recovery/${selectedId}` : null,
    valid
  );
  const data = read.data;
  const blocked = busy || !!action || read.loading || scope.denied || read.error;
  async function create(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || busy || action || !files.length) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    const input = { ...draft };
    const keys: string[] = [];
    try {
      for (const file of files) {
        const key = await uploadVerificationEvidence(file, input.profileId);
        if (!mounted.current) return;
        if (!key) throw new Error();
        keys.push(key);
      }
      setAction({
        title: t('auth.recovery.create', locale),
        description: `${input.profileId} · ${input.newLogin} · ${input.supportReference}`,
        path: '/api/crm/account-recovery',
        method: 'POST',
        successStatus: 201,
        expectedState: 'open',
        body: { ...input, evidenceKeys: keys },
      });
    } catch {
      if (mounted.current) setError(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function command(kind: string, body?: unknown) {
    if (!data || blocked) return;
    setError(false);
    setAction({
      title: t(`auth.recovery.${kind}`, locale),
      description: `${data.id} · ${data.targetUserId} · ${data.oldLogin} → ${data.newLogin}`,
      path: `/api/crm/account-recovery/${data.id}/${kind === 'approve' || kind === 'reject' ? 'review' : kind === 'sendCode' ? 'code' : kind}`,
      method: 'POST',
      ...(kind === 'sendCode'
        ? { codeReceipt: true }
        : {
            expectedState:
              kind === 'approve'
                ? 'approved'
                : kind === 'reject'
                  ? 'rejected'
                  : kind === 'apply'
                    ? 'applied'
                    : 'completed',
          }),
      ...(body === undefined ? {} : { body }),
    });
  }
  return (
    <section className="mx-auto max-w-3xl space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-semibold">{t('auth.recovery.title', locale)}</h1>
      <p>{t('auth.recovery.instructions', locale)}</p>
      <form onSubmit={(e) => void create(e)} className="rounded border p-4 space-y-3">
        <fieldset disabled={busy || !!action || scope.denied} className="space-y-3">
          {(Object.keys(draft) as Array<keyof typeof draft>).map((key) => (
            <div key={key}>
              <Label htmlFor={`recovery-${key}`}>{t(`auth.recovery.${key}`, locale)}</Label>
              <Input
                id={`recovery-${key}`}
                required
                value={draft[key]}
                onChange={(e) => setDraft((old) => ({ ...old, [key]: e.target.value }))}
              />
            </div>
          ))}
          <div>
            <Label htmlFor="recovery-evidence">{t('auth.recovery.evidence', locale)}</Label>
            <Input
              id="recovery-evidence"
              type="file"
              required
              multiple
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </div>
          <Button type="submit" disabled={files.length < 1 || files.length > 5}>
            {t('auth.recovery.create', locale)}
          </Button>
        </fieldset>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked && uuidPattern.test(caseId)) setSelectedId(caseId);
        }}
        className="flex flex-wrap gap-3 items-end"
      >
        <div>
          <Label htmlFor="recovery-case-id">{t('auth.recovery.caseId', locale)}</Label>
          <Input
            id="recovery-case-id"
            required
            value={caseId}
            disabled={busy || !!action}
            onChange={(e) => {
              setCaseId(e.target.value);
              setSelectedId(null);
            }}
          />
        </div>
        <Button type="submit" disabled={busy || !!action}>
          {t('auth.recovery.load', locale)}
        </Button>
      </form>
      {(error || read.error || scope.denied) && (
        <div role="alert">
          <p>{t('auth.recovery.error', locale)}</p>
          <Button onClick={() => (scope.denied ? scope.recover() : read.retry())}>
            {t('auth.recovery.load', locale)}
          </Button>
        </div>
      )}
      {(busy || read.loading) && <p role="status">{t('auth.recovery.loading', locale)}</p>}
      {data && (
        <article className="space-y-4 rounded border p-4 break-words">
          <dl>
            {(
              [
                'profileId',
                'oldLogin',
                'newLogin',
                'supportReference',
                'reason',
                'reviewerNotes',
                'state',
                'challengeId',
              ] as const
            ).map((key) => (
              <div key={key}>
                <dt className="font-semibold">{t(`auth.recovery.${key}`, locale)}</dt>
                <dd>
                  <bdi>
                    {key === 'state' ? t(`auth.recovery.state.${data.state}`, locale) : data[key]}
                  </bdi>
                </dd>
              </div>
            ))}
          </dl>
          {data.evidenceDownloadUrls.map((url, index) => {
            try {
              if (!['https:', 'http:'].includes(new URL(url).protocol)) return null;
            } catch {
              return null;
            }
            return (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block underline"
              >
                {t('auth.recovery.evidence', locale)} {index + 1}
              </a>
            );
          })}
          <Label htmlFor="recovery-notes">{t('auth.recovery.notes', locale)}</Label>
          <Input
            id="recovery-notes"
            value={notes}
            disabled={blocked}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={
                blocked || data.state !== 'open' || data.createdBy === actor || !notes.trim()
              }
              onClick={() => command('approve', { decision: 'approved', notes })}
            >
              {t('auth.recovery.approve', locale)}
            </Button>
            <Button
              variant="outline"
              disabled={
                blocked ||
                !['open', 'approved'].includes(data.state) ||
                data.createdBy === actor ||
                !notes.trim()
              }
              onClick={() => command('reject', { decision: 'rejected', notes })}
            >
              {t('auth.recovery.reject', locale)}
            </Button>
            <Button
              variant="outline"
              disabled={blocked || data.state !== 'approved'}
              onClick={() => command('sendCode')}
            >
              {t('auth.recovery.sendCode', locale)}
            </Button>
            <Button
              variant="destructive"
              disabled={
                blocked ||
                data.state !== 'approved' ||
                !data.contactVerified ||
                data.createdBy === actor
              }
              onClick={() => command('apply')}
            >
              {t('auth.recovery.apply', locale)}
            </Button>
          </div>
          {data.state === 'applied' && (
            <div className="space-y-3">
              {(['oldContact', 'newContact'] as const).map((key) => (
                <div key={key}>
                  <Label htmlFor={`recovery-notice-${key}`}>
                    {t(`auth.recovery.${key === 'oldContact' ? 'oldNotice' : 'newNotice'}`, locale)}
                  </Label>
                  <Input
                    id={`recovery-notice-${key}`}
                    disabled={blocked}
                    value={notices[key]}
                    onChange={(e) => setNotices((old) => ({ ...old, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <Button
                disabled={blocked || !notices.oldContact.trim() || !notices.newContact.trim()}
                onClick={() => command('complete', notices)}
              >
                {t('auth.recovery.complete', locale)}
              </Button>
            </div>
          )}
          <h2 className="font-semibold">{t('auth.recovery.history', locale)}</h2>
          <ol>
            {data.history.map((item, index) => (
              <li key={index}>
                <details>
                  <summary>
                    <bdi>
                      {item.created_at} · {item.event}
                    </bdi>
                  </summary>
                  <p>
                    <bdi>
                      {item.user_id} · {item.correlation_id}
                    </bdi>
                  </p>
                  <pre className="whitespace-pre-wrap break-words text-sm">{item.metadata}</pre>
                </details>
              </li>
            ))}
          </ol>
          <Button variant="outline" disabled={blocked} onClick={read.retry}>
            {t('auth.recovery.load', locale)}
          </Button>
        </article>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onDenied={() => scope.deny()}
          onSuccess={async (result) => {
            if (!mounted.current) return;
            if (
              typeof result !== 'object' ||
              result === null ||
              !('id' in result) ||
              typeof result.id !== 'string' ||
              !uuidPattern.test(result.id)
            )
              throw new Error('Unconfirmed recovery receipt');
            if (
              action.expectedState &&
              (!('state' in result) ||
                (result.state !== action.expectedState &&
                  !(action.expectedState === 'applied' && result.state === 'completed')))
            )
              throw new Error('Unconfirmed recovery state');
            if (
              action.codeReceipt &&
              (!('challengeId' in result) ||
                typeof result.challengeId !== 'string' ||
                !uuidPattern.test(result.challengeId))
            )
              throw new Error('Unconfirmed recovery challenge');
            if (selectedId && result.id !== selectedId) throw new Error('Wrong recovery receipt');
            setCaseId(result.id);
            setSelectedId(result.id);
            setAction(null);
            read.retry();
          }}
        />
      )}
    </section>
  );
}
