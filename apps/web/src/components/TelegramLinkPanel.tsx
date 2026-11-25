import { ConfirmProvider } from '@barghsa/ui';
import { useDestructiveConfirm } from '../hooks/useDestructiveConfirm.js';
import { useOwnedGateRead } from '../hooks/useOwnedGateRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LoadingStatus, Button, Input, Label } from '@barghsa/ui';
import { ArrowUpRight, CircleCheck, Send } from 'lucide-react';
import { t } from '@barghsa/i18n/app';
import { telegramText } from '@barghsa/i18n/telegram';
import { securitySettingsText } from '@barghsa/i18n/security-settings-forms';
import { useLocale } from '../hooks/useLocale.js';
import type { usePreferenceSettingsOwner } from '../hooks/usePreferenceSettingsForm.js';
import { withCsrf } from '../lib/csrf.js';
import { sendToast } from '../lib/toast-api.js';
import { accountErrorCode, accountWriteDenied } from '../lib/account-settings-form.js';
import { securityStepUpReceipt } from '../lib/security-settings-form.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import {
  telegramCode,
  telegramLinkReceipt,
  telegramStatus,
  type TelegramStatus,
} from '../lib/telegram-link.js';
import {
  RecordEditorActions,
  recordEditorField,
  recordEditorSurface,
} from './RecordEditorLayout.js';

type Scope = ReturnType<typeof usePreferenceSettingsOwner>;
type Action = 'create' | 'confirm' | 'revoke';
export default function TelegramLinkPanel(props: { scope: Scope; standalone?: boolean }) {
  return (
    <ConfirmProvider>
      <OwnedTelegramLinkPanel {...props} />
    </ConfirmProvider>
  );
}
function OwnedTelegramLinkPanel({ scope, standalone }: { scope: Scope; standalone?: boolean }) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readGate = useOwnedGateRead(JSON.stringify([scope.key, scope.denied]), actor, revision);
  const locale = useLocale(),
    id = useId();
  const confirmDestruction = useDestructiveConfirm(
    locale,
    JSON.stringify([scope.key, scope.denied])
  );
  const copy = (key: Parameters<typeof telegramText>[0]) => telegramText(key, locale);
  const [data, setData] = useState<{ key: string; value: TelegramStatus } | null>(null);
  const [url, setUrl] = useState<{ id: string; value: string } | null>(null);
  const [code, setCode] = useState(''),
    [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState<Action | null>(null),
    [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false),
    [loading, setLoading] = useState(true);
  const codeInput = useRef<HTMLInputElement>(null),
    passwordInput = useRef<HTMLInputElement>(null),
    sequence = useRef(0);
  const commandTransport = useRef<AbortController | null>(null);
  const current = useRef(scope);
  current.current = scope;
  const source = scope.isCurrent() && data?.key === scope.key ? data.value : null;
  const family = 'security:telegram';
  async function read(signal?: AbortSignal) {
    const attempt = ++sequence.current;
    try {
      const response = await readGate('/api/telegram/link', {
        credentials: 'include',
        ...(signal ? { signal } : {}),
      });
      if (!scope.isCurrent() || signal?.aborted || attempt !== sequence.current) return null;
      if ([401, 403].includes(response.status)) {
        scope.deny();
        return null;
      }
      const parsed = response.ok ? telegramStatus(await response.json()) : null;
      if (!scope.isCurrent() || signal?.aborted || attempt !== sequence.current) return null;
      if (!parsed) throw new Error('Telegram status unavailable');
      setData({ key: scope.key, value: parsed });
      setLoading(false);
      return parsed;
    } catch {
      if (scope.isCurrent() && !signal?.aborted && attempt === sequence.current) {
        setError(copy('error'));
        setLoading(false);
      }
      return null;
    }
  }
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    sequence.current++;
    setData(null);
    setUrl(null);
    setCode('');
    setPassword('');
    setNeedsPassword(null);
    setError(null);
    setUncertain(false);
    setLoading(true);
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted && current.current.isCurrent())
        void readRef.current(controller.signal);
    });
    return () => {
      controller.abort();
      commandTransport.current?.abort();
      sequence.current++;
    };
  }, [scope.key, scope.denied]);
  useEffect(() => {
    if (!source?.intent || uncertain) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (current.current.isCurrent() && !current.current.isLocked())
        void readRef.current(controller.signal);
    }, 2000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [source?.intent?.id, scope.key, uncertain]);

  async function act(action: Action, event?: FormEvent) {
    event?.preventDefault();
    if (!source || uncertain || !scope.claim(family)) return;
    const captured = {
      profile: source.profileId,
      intent: source.intent,
      link: source.link,
      code: telegramCode(code),
    };
    sequence.current++;
    setError(null);
    const transport = new AbortController();
    commandTransport.current = transport;
    try {
      if (
        action === 'revoke' &&
        (!(await confirmDestruction(copy('revoke'), copy('unlinkDescription'))) ||
          !scope.owns(family))
      )
        return;
      if (action === 'confirm' && !/^\d{6}$/.test(captured.code)) {
        setError(copy('invalidCode'));
        codeInput.current?.focus();
        return;
      }
      if (needsPassword) {
        if (!password) {
          setError(securitySettingsText('passwordRequired', locale));
          passwordInput.current?.focus();
          return;
        }
        const { proof, body } = await readWithDeadline(transport.signal, async (signal) => {
          const proof = await fetch('/api/auth/step-up', {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ password }),
            signal,
          });
          return { proof, body: (await proof.json().catch(() => null)) as unknown };
        });
        if (!scope.owns(family)) return;
        setPassword('');
        if (accountWriteDenied(proof.status, body)) {
          scope.deny();
          return;
        }
        if (proof.status !== 200 || !securityStepUpReceipt(body)) {
          setError(copy('error'));
          return;
        }
        const fresh = await read(transport.signal);
        if (!scope.owns(family) || !fresh || fresh.profileId !== captured.profile) return;
        setNeedsPassword(null);
        if (action === 'confirm') {
          setCode('');
          setUrl(null);
          setError(copy('relinkRequired'));
          return;
        }
      }
      if (action === 'confirm' && !captured.intent) return;
      const { response, body } = await readWithDeadline(transport.signal, async (signal) => {
        const response = await fetch(
          '/api/telegram/link' + (action === 'confirm' ? '/confirm' : ''),
          {
            method: action === 'revoke' ? 'DELETE' : 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            signal,
            ...(action === 'revoke'
              ? {}
              : {
                  body: JSON.stringify(
                    action === 'confirm' ? { id: captured.intent!.id, code: captured.code } : {}
                  ),
                }),
          }
        );
        return { response, body: (await response.json().catch(() => null)) as unknown };
      });
      if (!scope.owns(family)) return;
      if (response.status === 403 && accountErrorCode(body) === 'AUTHZ:STEP_UP_REQUIRED') {
        setNeedsPassword(action);
        setError(securitySettingsText('passwordRequired', locale));
        setTimeout(() => passwordInput.current?.focus(), 0);
        return;
      }
      if (accountWriteDenied(response.status, body)) {
        scope.deny();
        return;
      }
      if (!response.ok) {
        if (response.status >= 500 || response.status === 408)
          throw new Error('Telegram request outcome unavailable');
        const message = copy(
          response.status === 422 || response.status === 409 ? 'invalidCode' : 'error'
        );
        setError(message);
        sendToast('error', message);
        return;
      }
      if (action === 'create') {
        const receipt = telegramLinkReceipt(body);
        if (!receipt) throw new Error('Invalid Telegram receipt');
        const fresh = await read(transport.signal);
        if (
          !scope.owns(family) ||
          fresh?.profileId !== captured.profile ||
          fresh.intent?.id !== receipt.id
        )
          throw new Error('Telegram scope changed');
        setUrl({ id: receipt.id, value: receipt.url });
        setCode('');
      } else {
        const fresh = await read(transport.signal);
        if (!scope.owns(family) || !fresh) throw new Error('Telegram status unavailable');
        if (
          action === 'revoke'
            ? fresh.link !== null
            : !fresh.link ||
              fresh.link.telegram_user_id !== captured.intent?.telegram_user_id ||
              fresh.link.profile_id !== captured.profile
        )
          throw new Error('Telegram receipt not confirmed');
        setCode('');
        setUrl(null);
      }
      sendToast(
        'success',
        copy(action === 'create' ? 'linkReady' : action === 'confirm' ? 'linked' : 'unlinked')
      );
    } catch {
      if (scope.owns(family)) {
        setUncertain(true);
        const message = copy('requestUnknown');
        setError(message);
        sendToast('error', message);
      }
    } finally {
      if (commandTransport.current === transport) commandTransport.current = null;
      if (scope.isCurrent()) scope.release(family);
    }
  }
  async function refresh() {
    if (!scope.claim(family)) return;
    setLoading(true);
    setError(null);
    try {
      const fresh = await read();
      if (!fresh || !scope.owns(family)) return;
      setUncertain(false);
      if (uncertain || !fresh.intent || fresh.intent.id !== source?.intent?.id) {
        setUrl(null);
        setCode('');
      }
    } finally {
      scope.release(family);
    }
  }
  const Title = standalone ? 'h1' : 'h2';
  const activeUrl = url && source?.intent?.id === url.id ? url.value : null;
  const formDisabled = scope.locked || uncertain;
  const awaitingCode = source?.intent?.status === 'claimed';
  const proof = needsPassword ?? (awaitingCode ? 'confirm' : null);
  const canStart = source?.available && !needsPassword;
  const canCheck = scope.locked || loading || error || source?.intent || source?.latestDelivery;
  const reconnecting = source?.link || source?.intent;
  const chatLink = activeUrl && (
    <Button
      variant={awaitingCode ? 'outline' : 'default'}
      className="h-auto min-h-11 max-w-full whitespace-normal"
      render={
        <a
          href={activeUrl}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          aria-label={copy('open')}
        />
      }
      nativeButton={false}
      role="link"
      disabled={formDisabled}
    >
      {copy('open')}
      <ArrowUpRight aria-hidden="true" className="rtl:-scale-x-100" />
    </Button>
  );
  const hasNextStep = Boolean(proof || chatLink);
  const restart = canStart && (
    <Button
      type="button"
      variant={hasNextStep ? 'ghost' : source.link ? 'outline' : 'default'}
      disabled={formDisabled}
      onClick={() => void act('create')}
    >
      {copy(reconnecting ? 'restartLink' : 'connect')}
    </Button>
  );
  const checkStatus = canCheck ? (
    <Button
      type="button"
      variant={uncertain || (!source && error) ? 'default' : 'ghost'}
      disabled={scope.locked || loading}
      onClick={() => void refresh()}
    >
      {copy('refresh')}
    </Button>
  ) : null;
  const unlink = source?.link && !needsPassword && (
    <Button
      type="button"
      variant="ghost"
      className="text-destructive hover:text-destructive"
      disabled={formDisabled}
      onClick={() => void act('revoke')}
    >
      {copy('revoke')}
    </Button>
  );
  return (
    <section
      aria-labelledby={id + '-title'}
      className={recordEditorSurface}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="flex items-start gap-3 px-4 pt-4 pb-3 sm:px-6">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-primary">
          <Send aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <Title id={id + '-title'} className="text-lg leading-tight font-semibold">
            {copy('title')}
          </Title>
          <p className="text-sm text-muted-foreground">{copy('scope')}</p>
        </div>
      </header>
      {scope.isCurrent() && (
        <>
          <div className="space-y-3 px-4 py-3 empty:hidden sm:px-6">
            {loading && <LoadingStatus>{securitySettingsText('loading', locale)}</LoadingStatus>}
            {source && !source.available && (
              <p className="text-sm text-muted-foreground">{copy('unavailable')}</p>
            )}
            {source?.link && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-lg bg-success-soft px-3 py-2.5 text-sm"
              >
                <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                <div className="space-y-0.5">
                  <p className="font-medium">
                    {copy('linked')} <bdi>{source.link.telegram_user_id}</bdi>
                  </p>
                  {source.link.profile_id !== source.profileId && <p>{copy('otherProfile')}</p>}
                </div>
              </div>
            )}
            {source?.intent && !needsPassword && (
              <div className="space-y-1.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
                <p id={id + '-pending'}>{copy(awaitingCode ? 'claimed' : 'pending')}</p>
                {!awaitingCode && !activeUrl && (
                  <p className="text-muted-foreground">{copy('pendingNoLink')}</p>
                )}
              </div>
            )}
            {awaitingCode && !needsPassword && (
              <form
                onSubmit={(event) => void act('confirm', event)}
                id={id + '-proof'}
                aria-busy={scope.locked}
              >
                <div className={recordEditorField}>
                  <Label htmlFor={id + '-code'}>{copy('code')}</Label>
                  <Input
                    id={id + '-code'}
                    ref={codeInput}
                    value={code}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    dir="ltr"
                    className="min-h-11 max-w-40 font-mono tracking-widest text-center"
                    placeholder="000000"
                    aria-required="true"
                    aria-describedby={id + '-pending' + (error ? ' ' + id + '-error' : '')}
                    aria-invalid={error === copy('invalidCode')}
                    disabled={formDisabled}
                    onChange={(event) => {
                      if (!scope.isCurrent() || scope.isLocked()) return;
                      setCode(telegramCode(event.target.value));
                      if (error === copy('invalidCode')) setError(null);
                    }}
                  />
                </div>
              </form>
            )}
            {needsPassword && (
              <form
                onSubmit={(event) => void act(needsPassword, event)}
                id={id + '-proof'}
                aria-busy={scope.locked}
              >
                <div className={`${recordEditorField} w-full max-w-64`}>
                  <Label htmlFor={id + '-password'}>
                    {t('settings.security.passwordLabel', locale)}
                  </Label>
                  <Input
                    id={id + '-password'}
                    ref={passwordInput}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    disabled={formDisabled}
                    aria-required="true"
                    aria-describedby={error ? id + '-error' : undefined}
                    onChange={(event) => {
                      if (scope.isCurrent() && !scope.isLocked()) setPassword(event.target.value);
                    }}
                  />
                </div>
              </form>
            )}
            {error && (
              <p
                id={id + '-error'}
                role="alert"
                className="rounded-md bg-danger-soft px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {source?.latestDelivery?.status === 'unknown' && (
              <p role="status" className="text-sm">
                {copy('deliveryUnknown')}
              </p>
            )}
            {source?.latestDelivery?.status === 'failed' && (
              <p role="status" className="text-sm">
                {copy('deliveryFailed')}
              </p>
            )}
          </div>
          {hasNextStep ? (
            <RecordEditorActions className="[&>div]:w-full">
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {proof && (
                    <Button type="submit" form={id + '-proof'} disabled={formDisabled}>
                      {copy(
                        proof === 'revoke' ? 'revoke' : proof === 'confirm' ? 'confirm' : 'connect'
                      )}
                    </Button>
                  )}
                  {!needsPassword && chatLink}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-1 empty:hidden">
                  {checkStatus}
                  {restart}
                  {unlink}
                </div>
              </div>
            </RecordEditorActions>
          ) : (
            (canCheck || canStart || unlink) && (
              <RecordEditorActions secondary={checkStatus}>
                {restart}
                {unlink}
              </RecordEditorActions>
            )
          )}
        </>
      )}
    </section>
  );
}
