import { useEffect, useId, useRef, useState } from 'react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/app';
import { withCsrf } from '../lib/csrf.js';
import { isConversationPhoto, uploadConversationPhoto } from '../lib/branding-logo-upload.js';

type Identity = {
  displayName: string | null;
  avatarUrl: string | null;
  avatarUploadKey: string | null;
  revision: number;
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
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision) ||
    value.revision < 0
  )
    throw new Error('load');
  return value as Identity;
}

export function ConversationIdentityDialog({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const id = useId();
  const photoInput = useRef<HTMLInputElement | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const uploaded = useRef<{ file: File; key: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    setError(null);
    void fetch(endpoint, { credentials: 'include', signal: abort.signal })
      .then(readIdentity)
      .then((value) => {
        if (!abort.signal.aborted) {
          setIdentity(value);
          setName(value.displayName ?? '');
        }
      })
      .catch((reason: unknown) => {
        if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'load');
      });
    return () => abort.abort();
  }, [attempt]);

  async function save() {
    if (!identity || submitting.current) return;
    const displayName = name.trim() || null;
    if (
      displayName &&
      (displayName.length > 80 || /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(displayName))
    ) {
      setError('nameError');
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(null);
    const signal = controller.current!.signal;
    try {
      let avatarUploadKey: string | null | undefined = removePhoto ? null : undefined;
      if (file) {
        if (uploaded.current?.file !== file)
          uploaded.current = { file, key: await uploadConversationPhoto(file, signal) };
        avatarUploadKey = uploaded.current.key;
      }
      if (signal.aborted) return;
      const response = await fetch(endpoint, {
        method: 'PUT',
        credentials: 'include',
        signal,
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          displayName,
          revision: identity.revision,
          ...(avatarUploadKey !== undefined ? { avatarUploadKey } : {}),
        }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          const latest = await readIdentity(
            await fetch(endpoint, { credentials: 'include', signal })
          );
          if (!signal.aborted) setIdentity(latest);
          throw new Error('conflict');
        }
        throw new Error(response.status === 401 || response.status === 403 ? 'denied' : 'save');
      }
      await readIdentity(response);
      if (!signal.aborted) onClose();
    } catch (reason) {
      if (!signal.aborted) {
        const message = reason instanceof Error ? reason.message : 'save';
        setError(['denied', 'conflict'].includes(message) ? message : 'save');
        if (message === 'denied') {
          setName('');
          setFile(null);
          uploaded.current = null;
          setIdentity(null);
        }
      }
    } finally {
      submitting.current = false;
      if (!signal.aborted) setPending(false);
    }
  }
  const text = (key: string) => t(`conversationIdentity.${key}`, locale);
  const avatar = !removePhoto && !file ? identity?.avatarUrl : null;
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
                dir="auto"
                value={name}
                maxLength={80}
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{text('nameHelp')}</p>
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
                  disabled={pending}
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
                  disabled={pending}
                  className="flex-1"
                  onClick={() => photoInput.current?.click()}
                >
                  {text('choosePhoto')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{text('photoHelp')}</p>
              {file && (
                <p dir="auto" className="break-all text-sm">
                  {file.name}
                </p>
              )}
              {(file || (!removePhoto && identity.avatarUploadKey)) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
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
              <p role="alert" className="text-sm text-destructive">
                {text(error)}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
                {text('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {text(pending ? 'saving' : 'saveAction')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
