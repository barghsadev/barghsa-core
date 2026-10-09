import { useOwnedGateRead } from '../hooks/useOwnedGateRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { telegramText } from '@barghsa/i18n/telegram';
import { securitySettingsText } from '@barghsa/i18n/security-settings-forms';
import { useLocale } from '../hooks/useLocale.js';
import type { usePreferenceSettingsOwner } from '../hooks/usePreferenceSettingsForm.js';
import { withCsrf } from '../lib/csrf.js';
import { accountErrorCode, accountWriteDenied } from '../lib/account-settings-form.js';
import { securityStepUpReceipt } from '../lib/security-settings-form.js';
import {
  telegramCode,
  telegramLinkReceipt,
  telegramStatus,
  type TelegramStatus,
} from '../lib/telegram-link.js';

type Scope = ReturnType<typeof usePreferenceSettingsOwner>;
type Action = 'create' | 'confirm' | 'revoke';
export default function TelegramLinkPanel({ scope }: { scope: Scope }) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readGate = useOwnedGateRead(JSON.stringify([scope.key, scope.denied]), actor, revision);
  const locale = useLocale(),
    id = useId();
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
    if (current.current.isCurrent()) void readRef.current(controller.signal);
    return () => {
      controller.abort();
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
    try {
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
        const proof = await fetch('/api/auth/step-up', {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ password }),
        });
        const body: unknown = await proof.json().catch(() => null);
        setPassword('');
        if (!scope.owns(family)) return;
        if (accountWriteDenied(proof.status, body)) {
          scope.deny();
          return;
        }
        if (proof.status !== 200 || !securityStepUpReceipt(body)) {
          setError(copy('error'));
          return;
        }
        const fresh = await read();
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
      const response = await fetch(
        '/api/telegram/link' + (action === 'confirm' ? '/confirm' : ''),
        {
          method: action === 'revoke' ? 'DELETE' : 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          ...(action === 'revoke'
            ? {}
            : {
                body: JSON.stringify(
                  action === 'confirm' ? { id: captured.intent!.id, code: captured.code } : {}
                ),
              }),
        }
      );
      const body: unknown = await response.json().catch(() => null);
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
        setError(
          copy(response.status === 422 || response.status === 409 ? 'invalidCode' : 'error')
        );
        return;
      }
      if (action === 'create') {
        const receipt = telegramLinkReceipt(body);
        if (!receipt) throw new Error('Invalid Telegram receipt');
        const fresh = await read();
        if (
          !scope.owns(family) ||
          fresh?.profileId !== captured.profile ||
          fresh.intent?.id !== receipt.id
        )
          throw new Error('Telegram scope changed');
        setUrl({ id: receipt.id, value: receipt.url });
        setCode('');
      } else {
        const fresh = await read();
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
    } catch {
      if (scope.owns(family)) {
        setUncertain(true);
        setError(copy('requestUnknown'));
      }
    } finally {
      if (scope.isCurrent()) scope.release(family);
    }
  }
  async function refresh() {
    if (!scope.claim(family)) return;
    try {
      if (await read()) {
        setUncertain(false);
        setUrl(null);
        setCode('');
      }
    } finally {
      scope.release(family);
    }
  }
  return (
    <section
      aria-labelledby={id + '-title'}
      className="rounded-xl border bg-card p-4 space-y-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h2 id={id + '-title'} className="text-lg font-semibold">
        {copy('title')}
      </h2>
      <p className="text-sm text-muted-foreground">{copy('scope')}</p>
      {scope.isCurrent() && (
        <>
          {loading && <p role="status">{securitySettingsText('loading', locale)}</p>}
          {source && !source.available && <p>{copy('unavailable')}</p>}
          {source?.link && (
            <div role="status" className="text-sm space-y-1">
              <p>
                {copy('linked')} <bdi>{source.link.telegram_user_id}</bdi>
              </p>
              {source.link.profile_id !== source.profileId && <p>{copy('otherProfile')}</p>}
            </div>
          )}
          {source?.intent && (
            <p id={id + '-pending'} className="text-sm">
              {copy(source.intent.status === 'claimed' ? 'claimed' : 'pending')}
            </p>
          )}
          {url && source?.intent?.id === url.id && (
            <Button
              render={
                <a
                  href={url.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  aria-label={copy('open')}
                />
              }
              nativeButton={false}
              role="link"
              disabled={scope.locked || uncertain}
            >
              {copy('open')}
            </Button>
          )}
          {source?.intent?.status === 'claimed' && !needsPassword && (
            <form
              onSubmit={(event) => void act('confirm', event)}
              className="space-y-2"
              aria-busy={scope.locked}
            >
              <Label htmlFor={id + '-code'}>{copy('code')}</Label>
              <Input
                id={id + '-code'}
                ref={codeInput}
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                dir="ltr"
                aria-describedby={id + '-pending' + (error ? ' ' + id + '-error' : '')}
                aria-invalid={error === copy('invalidCode')}
                disabled={scope.locked || uncertain}
                onChange={(event) => {
                  if (scope.isCurrent() && !scope.isLocked())
                    setCode(telegramCode(event.target.value));
                }}
              />
              <Button type="submit" disabled={scope.locked || uncertain}>
                {copy('confirm')}
              </Button>
            </form>
          )}
          {needsPassword && (
            <form
              onSubmit={(event) => void act(needsPassword, event)}
              className="space-y-2"
              aria-busy={scope.locked}
            >
              <Label htmlFor={id + '-password'}>
                {securitySettingsText('passwordRequired', locale)}
              </Label>
              <Input
                id={id + '-password'}
                ref={passwordInput}
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={scope.locked || uncertain}
                aria-describedby={error ? id + '-error' : undefined}
                onChange={(event) => {
                  if (scope.isCurrent() && !scope.isLocked()) setPassword(event.target.value);
                }}
              />
              <Button type="submit" disabled={scope.locked || uncertain}>
                {copy(
                  needsPassword === 'revoke'
                    ? 'revoke'
                    : needsPassword === 'confirm'
                      ? 'confirm'
                      : 'connect'
                )}
              </Button>
            </form>
          )}
          {error && (
            <p id={id + '-error'} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {source?.available && !needsPassword && (
              <Button
                type="button"
                variant="outline"
                disabled={scope.locked || uncertain}
                onClick={() => void act('create')}
              >
                {copy('connect')}
              </Button>
            )}
            {source?.link && !needsPassword && (
              <Button
                type="button"
                variant="outline"
                disabled={scope.locked || uncertain}
                onClick={() => void act('revoke')}
              >
                {copy('revoke')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={scope.locked}
              onClick={() => void refresh()}
            >
              {copy('refresh')}
            </Button>
          </div>
        </>
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
    </section>
  );
}
