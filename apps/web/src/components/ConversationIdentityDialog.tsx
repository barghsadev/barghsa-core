import { useEffect, useId, useRef, useState } from 'react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Label,
} from '@barghsa/ui';
import { ImagePlus, Trash2, Undo2, X } from 'lucide-react';
import { t, type Locale } from '@barghsa/i18n/conversation-identity';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { sendToast, toast } from '../lib/toast-api.js';
import { withCsrf } from '../lib/csrf.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { isConversationPhoto, uploadConversationPhoto } from '../lib/branding-logo-upload.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';

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
  presentation = 'dialog',
}: {
  locale: Locale;
  onClose: () => void;
  presentation?: 'dialog' | 'page';
}) {
  const id = useId();
  const nameInput = useRef<HTMLInputElement | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const choosePhoto = useRef<HTMLButtonElement | null>(null);
  const checkButton = useRef<HTMLButtonElement | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [name, setName] = useState('');
  const [shareInActivity, setShareInActivity] = useState(false);
  const [shareInPaymentActivity, setShareInPaymentActivity] = useState(false);
  const [photo, setPhoto] = useState<{ file: File; preview: string | null } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [pending, setPending] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState<IdentityCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const uploaded = useRef<{ file: File; key: string } | null>(null);
  const file = photo?.file;
  useEffect(() => {
    const preview = photo?.preview;
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [photo]);
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
      setPhoto(null);
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
  const savedPhoto = identity?.avatarUrl;
  const avatar = photo
    ? photo.preview
    : !removePhoto && savedPhoto && /^https?:\/\//i.test(savedPhoto)
      ? savedPhoto
      : null;
  const hasName = name.trim().length > 0;
  const locked = pending || unconfirmed !== null;
  const onPage = presentation === 'page';
  const direction = locale === 'fa' ? 'rtl' : 'ltr';
  const errorId = `${id}-error`;
  const notice = error && (
    <p id={errorId} role="alert" className="text-sm text-destructive">
      {text(error)}
    </p>
  );
  const sharing = [
    {
      key: 'activity',
      field: 'shareInActivity',
      checked: shareInActivity,
      update: setShareInActivity,
    },
    {
      key: 'paymentActivity',
      field: 'shareInPaymentActivity',
      checked: shareInPaymentActivity,
      update: setShareInPaymentActivity,
    },
  ] as const;
  const content = !identity ? (
    <div className="space-y-3 px-4 py-4 sm:px-6">
      {error ? (
        <>
          {notice}
          {error !== 'denied' && (
            <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {text('retry')}
            </Button>
          )}
        </>
      ) : (
        <p role="status">{text('loading')}</p>
      )}
    </div>
  ) : (
    <form
      aria-label={text('title')}
      aria-busy={pending || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex min-h-0 flex-col"
    >
      <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>{text('name')}</Label>
          <input
            id={`${id}-name`}
            ref={nameInput}
            className="h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive md:text-sm"
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
          {error === 'nameError' && notice}
        </div>

        <div className="min-w-0 space-y-2 rounded-lg border px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar aria-hidden="true" className="size-12">
              {avatar && <AvatarImage src={avatar} alt="" referrerPolicy="no-referrer" />}
              <AvatarFallback>
                {Array.from(name.trim() || text('fallback'))
                  .slice(0, 2)
                  .join('')}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <Label htmlFor={`${id}-photo`}>{text('photo')}</Label>
              <p
                role="status"
                dir="auto"
                className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]"
              >
                {file
                  ? file.name
                  : text(
                      removePhoto ? 'photoRemovalPending' : savedPhoto ? 'photoSaved' : 'photoEmpty'
                    )}
              </p>
            </div>
            <input
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
                setPhoto({
                  file: selected,
                  preview:
                    typeof URL.createObjectURL === 'function'
                      ? URL.createObjectURL(selected)
                      : null,
                });
                uploaded.current = null;
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              ref={choosePhoto}
              type="button"
              variant="outline"
              size="sm"
              disabled={locked}
              aria-describedby={`${id}-photo-help${error === 'photoError' ? ` ${errorId}` : ''}`}
              onClick={() => photoInput.current?.click()}
            >
              <ImagePlus aria-hidden="true" />
              {text('choosePhoto')}
            </Button>
            {file ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={locked}
                onClick={() => {
                  setPhoto(null);
                  uploaded.current = null;
                  if (error === 'photoError') setError(null);
                  choosePhoto.current?.focus();
                }}
              >
                <X aria-hidden="true" />
                {text('discardPhoto')}
              </Button>
            ) : removePhoto ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={locked}
                onClick={() => {
                  setRemovePhoto(false);
                  choosePhoto.current?.focus();
                }}
              >
                <Undo2 aria-hidden="true" />
                {text('undoPhotoRemoval')}
              </Button>
            ) : identity.avatarUploadKey ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={locked}
                onClick={() => {
                  setRemovePhoto(true);
                  choosePhoto.current?.focus();
                }}
              >
                <Trash2 aria-hidden="true" />
                {text('remove')}
              </Button>
            ) : null}
          </div>
          <p id={`${id}-photo-help`} className="text-xs text-muted-foreground">
            {text('photoHelp')}
          </p>
          {error === 'photoError' && notice}
        </div>

        <fieldset disabled={locked || !hasName} className="min-w-0 space-y-2">
          <legend className="text-sm font-semibold">{text('sharingTitle')}</legend>
          <p className="text-xs text-muted-foreground">
            {text(hasName ? 'sharingHelp' : 'sharingNameRequired')}
          </p>
          <div className="divide-y rounded-lg border bg-muted/35">
            {sharing.map(({ key, field, checked, update }) => {
              const optionId = `${id}-${field}`;
              return (
                <label
                  key={key}
                  className="flex min-h-11 cursor-pointer items-start gap-2.5 px-3 py-2.5"
                >
                  <input
                    type="checkbox"
                    id={optionId}
                    name={field}
                    checked={checked}
                    aria-labelledby={`${optionId}-label`}
                    aria-describedby={`${optionId}-help`}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    onChange={(event) => update(event.currentTarget.checked)}
                  />
                  <span className="min-w-0 space-y-1">
                    <span id={`${optionId}-label`} className="block text-sm font-medium">
                      {text(key)}
                    </span>
                    <span id={`${optionId}-help`} className="block text-xs text-muted-foreground">
                      {text(`${key}Help`)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {error !== 'nameError' && error !== 'photoError' && notice}
      </div>
      <RecordEditorActions className="shrink-0">
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
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
      </RecordEditorActions>
    </form>
  );

  if (onPage)
    return (
      <section dir={direction} className="mx-auto min-w-0 max-w-2xl space-y-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">{text('title')}</h1>
          <p className="text-sm text-muted-foreground">{text('description')}</p>
        </header>
        <div className={recordEditorSurface}>{content}</div>
      </section>
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting.current) onClose();
      }}
    >
      <DialogContent
        dir={direction}
        closeLabel={text('cancel')}
        showCloseButton={!pending}
        className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogHeader className="border-b px-4 py-4 pe-12 sm:px-6 sm:pe-12">
          <DialogTitle>{text('title')}</DialogTitle>
          <DialogDescription>{text('description')}</DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
