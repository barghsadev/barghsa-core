import { useEffect, useId, useRef, useState } from 'react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/conversation-identity';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { sendToast, toast } from '../lib/toast-api.js';
import { withCsrf } from '../lib/csrf.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { isConversationPhoto, uploadConversationPhoto } from '../lib/branding-logo-upload.js';

type Identity = {
  displayName: string | null;
  avatarUrl: string | null;
  avatarUploadKey: string | null;
  revision: number;
  shareInActivity: boolean;
  shareInPaymentActivity: boolean;
};
type IdentityCommand = Omit<Identity, 'avatarUrl' | 'avatarUploadKey'> & {
  avatarUploadKey?: string | null;
};
const endpoint = '/api/user/settings/conversation-identity';
async function readIdentity(response: Response): Promise<Identity> {
  if (!response.ok)
    throw new Error(response.status === 401 || response.status === 403 ? 'denied' : 'load');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object') throw new Error('load');
  const value = data as Record<string, unknown>;
  if (
    (value.displayName !== null && typeof value.displayName !== 'string') ||
    (value.avatarUrl !== null && typeof value.avatarUrl !== 'string') ||
    (value.avatarUploadKey !== null && typeof value.avatarUploadKey !== 'string') ||
    (value.shareInActivity !== undefined && typeof value.shareInActivity !== 'boolean') ||
    (value.shareInPaymentActivity !== undefined &&
      typeof value.shareInPaymentActivity !== 'boolean') ||
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision) ||
    value.revision < 0
  )
    throw new Error('load');
  return {
    ...value,
    shareInActivity: value.shareInActivity ?? false,
    shareInPaymentActivity: value.shareInPaymentActivity ?? false,
  } as Identity;
}

function loadIdentity(parent: AbortSignal) {
  return readWithDeadline(parent, async (signal) =>
    readIdentity(await fetch(endpoint, { credentials: 'include', cache: 'no-store', signal }))
  );
}

function matchesIdentity(saved: Identity, command: IdentityCommand) {
  return (
    saved.displayName === command.displayName &&
    saved.shareInActivity === command.shareInActivity &&
    saved.shareInPaymentActivity === command.shareInPaymentActivity &&
    (command.avatarUploadKey === undefined || saved.avatarUploadKey === command.avatarUploadKey) &&
    (saved.revision === command.revision || saved.revision === command.revision + 1)
  );
}

export function ConversationIdentityDialog({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const id = useId();
  const nameInput = useRef<HTMLInputElement | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const checkButton = useRef<HTMLButtonElement | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [name, setName] = useState('');
  const [shareInActivity, setShareInActivity] = useState(false);
  const [shareInPaymentActivity, setShareInPaymentActivity] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [pending, setPending] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState<IdentityCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const uploaded = useRef<{ file: File; key: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    setError(null);
    void loadIdentity(abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) {
          setIdentity(value);
          setName(value.displayName ?? '');
          setShareInActivity(value.shareInActivity);
          setShareInPaymentActivity(value.shareInPaymentActivity);
        }
      })
      .catch((reason: unknown) => {
        if (!abort.signal.aborted)
          setError(reason instanceof Error && reason.message === 'denied' ? 'denied' : 'load');
      });
    return () => abort.abort();
  }, [attempt]);
  useEffect(() => {
    if (unconfirmed && !pending) checkButton.current?.focus();
  }, [unconfirmed, pending]);

  function reportFailure(code: 'denied' | 'conflict' | 'save' | 'unconfirmed' | 'checkFailed') {
    setError(code);
    const message = t(`conversationIdentity.${code}`, locale);
    if (code === 'unconfirmed') sendToast('warning', message);
    else toast.error(message);
    if (code === 'denied') {
      setName('');
      setShareInActivity(false);
      setShareInPaymentActivity(false);
      setFile(null);
      setRemovePhoto(false);
      uploaded.current = null;
      setIdentity(null);
      setUnconfirmed(null);
    }
  }

  function confirmSaved(saved: Identity, command: IdentityCommand) {
    if (saved.revision !== command.revision) toast.success(confirmationText('recorded', locale));
    onClose();
  }

  async function checkSaved() {
    if (!unconfirmed || submitting.current) return;
    const signal = controller.current!.signal;
    submitting.current = true;
    setPending(true);
    try {
      const latest = await loadIdentity(signal);
      if (signal.aborted) return;
      if (latest.revision < unconfirmed.revision) throw new Error('load');
      if (matchesIdentity(latest, unconfirmed)) {
        confirmSaved(latest, unconfirmed);
        return;
      }
      setIdentity(latest);
      setUnconfirmed(null);
      setError(latest.revision === unconfirmed.revision ? 'retrySave' : 'conflict');
    } catch (reason) {
      if (!signal.aborted)
        reportFailure(
          reason instanceof Error && reason.message === 'denied' ? 'denied' : 'checkFailed'
        );
    } finally {
      submitting.current = false;
      if (!signal.aborted) setPending(false);
    }
  }

  async function save() {
    if (!identity || unconfirmed || submitting.current) return;
    const displayName = name.trim() || null;
    if (
      displayName &&
      (displayName.length > 80 || /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(displayName))
    ) {
      setError('nameError');
      nameInput.current?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(null);
    const signal = controller.current!.signal;
    let command: IdentityCommand | undefined;
    try {
      let avatarUploadKey: string | null | undefined = removePhoto ? null : undefined;
      if (file) {
        if (uploaded.current?.file !== file)
          uploaded.current = {
            file,
            key: await readWithDeadline(
              signal,
              (transport) => uploadConversationPhoto(file, transport),
              30_000
            ),
          };
        avatarUploadKey = uploaded.current.key;
      }
      if (signal.aborted) return;
      const request: IdentityCommand = {
        displayName,
        revision: identity.revision,
        shareInActivity: displayName !== null && shareInActivity,
        shareInPaymentActivity: displayName !== null && shareInPaymentActivity,
        ...(avatarUploadKey !== undefined ? { avatarUploadKey } : {}),
      };
      command = request;
      const saved = await readWithDeadline(signal, async (transport) => {
        const response = await fetch(endpoint, {
          method: 'PUT',
          credentials: 'include',
          signal: transport,
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(request),
        });
        if (response.status === 409) return null;
        if (!response.ok)
          throw new Error(response.status === 401 || response.status === 403 ? 'denied' : 'save');
        return readIdentity(response);
      });
      if (signal.aborted) return;
      if (!saved) {
        const latest = await loadIdentity(signal);
        if (signal.aborted) return;
        if (latest.revision < identity.revision) throw new Error('load');
        setIdentity(latest);
        throw new Error('conflict');
      }
      if (!matchesIdentity(saved, request)) throw new Error('receipt');
      confirmSaved(saved, request);
    } catch (reason) {
      if (!signal.aborted) {
        const message = reason instanceof Error ? reason.message : '';
        if (message === 'denied' || message === 'conflict' || message === 'save')
          reportFailure(message);
        else if (command) {
          setUnconfirmed(command);
          reportFailure('unconfirmed');
        } else reportFailure('save');
      }
    } finally {
      submitting.current = false;
      if (!signal.aborted) setPending(false);
    }
  }
  const text = (key: string) => t(`conversationIdentity.${key}`, locale);
  const avatar = !removePhoto && !file ? identity?.avatarUrl : null;
  const locked = pending || unconfirmed !== null;
  const errorId = `${id}-error`;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting.current) onClose();
      }}
    >
      <DialogContent
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        closeLabel={text('cancel')}
        showCloseButton={!pending}
        className="sm:max-w-md max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{text('title')}</DialogTitle>
          <DialogDescription>{text('description')}</DialogDescription>
        </DialogHeader>
        {!identity ? (
          <div className="space-y-3">
            {error ? (
              <>
                <p role="alert">{text(error === 'denied' ? 'denied' : 'load')}</p>
                {error !== 'denied' && (
                  <Button onClick={() => setAttempt((value) => value + 1)}>{text('retry')}</Button>
                )}
              </>
            ) : (
              <p role="status">{text('loading')}</p>
            )}
          </div>
        ) : (
          <form
            aria-busy={pending || undefined}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor={`${id}-name`}>{text('name')}</Label>
              <Input
                id={`${id}-name`}
                ref={nameInput}
                dir="auto"
                value={name}
                maxLength={80}
                disabled={locked}
                aria-invalid={error === 'nameError' || undefined}
                aria-describedby={`${id}-name-help${error === 'nameError' ? ` ${errorId}` : ''}`}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error === 'nameError') setError(null);
                  if (!event.target.value.trim()) {
                    setShareInActivity(false);
                    setShareInPaymentActivity(false);
                  }
                }}
              />
              <p id={`${id}-name-help`} className="text-xs text-muted-foreground">
                {text('nameHelp')}
              </p>
            </div>
            <div className="space-y-2">
              <div className="relative flex items-start gap-2">
                <Checkbox
                  id={`${id}-activity`}
                  name="shareInActivity"
                  checked={shareInActivity}
                  disabled={locked || !name.trim()}
                  aria-describedby={`${id}-activity-help`}
                  onCheckedChange={(checked) => setShareInActivity(checked === true)}
                />
                <Label htmlFor={`${id}-activity`} className="leading-5">
                  {text('activity')}
                </Label>
              </div>
              <p id={`${id}-activity-help`} className="text-xs text-muted-foreground">
                {text('activityHelp')}
              </p>
            </div>
            <div className="space-y-2">
              <div className="relative flex items-start gap-2">
                <Checkbox
                  id={`${id}-payment-activity`}
                  name="shareInPaymentActivity"
                  checked={shareInPaymentActivity}
                  disabled={locked || !name.trim()}
                  aria-describedby={`${id}-payment-activity-help`}
                  onCheckedChange={(checked) => setShareInPaymentActivity(checked === true)}
                />
                <Label htmlFor={`${id}-payment-activity`} className="leading-5">
                  {text('paymentActivity')}
                </Label>
              </div>
              <p id={`${id}-payment-activity-help`} className="text-xs text-muted-foreground">
                {text('paymentActivityHelp')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-photo`}>{text('photo')}</Label>
              <div className="flex items-center gap-3">
                <Avatar aria-hidden="true">
                  {avatar && /^https?:\/\//i.test(avatar) && (
                    <AvatarImage src={avatar} alt="" referrerPolicy="no-referrer" />
                  )}
                  <AvatarFallback>
                    {Array.from(name.trim() || text('fallback'))
                      .slice(0, 2)
                      .join('')}
                  </AvatarFallback>
                </Avatar>
                <Input
                  id={`${id}-photo`}
                  ref={photoInput}
                  hidden
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  disabled={locked}
                  onChange={(event) => {
                    const selected = event.target.files?.[0];
                    event.target.value = '';
                    if (!selected) return;
                    if (!isConversationPhoto(selected)) {
                      setError('photoError');
                      return;
                    }
                    setError(null);
                    setFile(selected);
                    uploaded.current = null;
                    setRemovePhoto(false);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked}
                  className="flex-1"
                  aria-describedby={`${id}-photo-help${error === 'photoError' ? ` ${errorId}` : ''}`}
                  onClick={() => photoInput.current?.click()}
                >
                  {text('choosePhoto')}
                </Button>
              </div>
              <p id={`${id}-photo-help`} className="text-xs text-muted-foreground">
                {text('photoHelp')}
              </p>
              {file && (
                <p dir="auto" className="break-all text-sm">
                  {file.name}
                </p>
              )}
              {(file || (!removePhoto && identity.avatarUploadKey)) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked}
                  onClick={() => {
                    setFile(null);
                    uploaded.current = null;
                    setRemovePhoto(true);
                  }}
                >
                  {text('remove')}
                </Button>
              )}
            </div>
            {error && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {text(error)}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
                {text('cancel')}
              </Button>
              {unconfirmed ? (
                <Button
                  ref={checkButton}
                  type="button"
                  disabled={pending}
                  onClick={() => void checkSaved()}
                >
                  {text(pending ? 'loading' : 'checkSaved')}
                </Button>
              ) : (
                <Button type="submit" disabled={pending}>
                  {text(pending ? 'saving' : 'saveAction')}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
