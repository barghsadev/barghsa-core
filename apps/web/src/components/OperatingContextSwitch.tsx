import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Button } from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import { workspaceModeText } from '@barghsa/i18n/workspace-mode';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { withCsrf } from '../lib/csrf.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { readSessionContext, type SessionContext } from '../lib/session-role.js';

interface OperatingContextProps {
  area: 'dashboard' | 'admin';
  locale: 'fa' | 'en';
  session?: SessionContext | null;
}

export function OperatingContextSwitch(props: OperatingContextProps) {
  const actor = useAccountUser();
  return <OwnedContextSwitch key={JSON.stringify([actor, props.area])} {...props} />;
}

function OwnedContextSwitch({ area, locale, session }: OperatingContextProps) {
  const [canSwitch, setCanSwitch] = useState(false);
  const [state, setState] = useState<'ready' | 'pending' | 'denied' | 'unconfirmed'>('ready');
  const request = useRef<AbortController | null>(null);
  const current = area === 'admin' ? 'staff' : 'customer';
  const target = current === 'staff' ? 'customer' : 'staff';
  const switchLabel = workspaceModeText(target === 'staff' ? 'toStaff' : 'toCustomer', locale);

  useEffect(() => {
    if (session !== undefined) {
      setCanSwitch(session?.canSwitchContext ?? false);
      return;
    }
    const controller = new AbortController();
    void readSessionContext(controller.signal)
      .then((session) => {
        if (!controller.signal.aborted) setCanSwitch(session?.canSwitchContext ?? false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCanSwitch(false);
      });
    return () => controller.abort();
  }, [session]);

  useEffect(() => () => request.current?.abort(), []);

  async function switchContext() {
    if (request.current || state === 'unconfirmed' || !canSwitch) return;
    const controller = new AbortController();
    request.current = controller;
    setState('pending');
    try {
      const outcome = await readWithDeadline(controller.signal, async (signal) => {
        const response = await fetch('/api/auth/sessions/context', {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ context: target }),
          signal,
        });
        if (!response.ok)
          return response.status >= 400 && response.status < 500 ? 'denied' : 'unconfirmed';
        const receipt: unknown = await response.json();
        return receipt &&
          typeof receipt === 'object' &&
          'operatingContext' in receipt &&
          receipt.operatingContext === target
          ? 'confirmed'
          : 'unconfirmed';
      });
      if (outcome === 'confirmed') window.location.assign('/app');
      else setState(outcome);
    } catch {
      if (!controller.signal.aborted) setState('unconfirmed');
    } finally {
      request.current = null;
    }
  }

  return (
    <div
      className="relative flex flex-wrap items-center gap-1.5"
      aria-label={shellText(`${current}Context`, locale)}
    >
      <span className="whitespace-nowrap rounded-md border border-current/20 px-2 py-1 text-xs font-semibold">
        {shellText(`${current}Context`, locale)}
      </span>
      {canSwitch ? (
        <Button
          type="button"
          variant="ghost"
          size="default"
          disabled={state === 'pending' || state === 'unconfirmed'}
          onClick={() => void switchContext()}
          aria-label={switchLabel}
        >
          <ArrowLeftRight className="size-4" aria-hidden="true" />
          <span className="inline">{switchLabel}</span>
        </Button>
      ) : null}
      {state === 'denied' || state === 'unconfirmed' ? (
        <div className="basis-full space-y-1 text-xs text-destructive">
          <p role="alert">
            {state === 'denied'
              ? workspaceModeText('denied', locale)
              : shellText('changeUnconfirmed', locale)}
          </p>
          {state === 'unconfirmed' && (
            <Button type="button" variant="outline" onClick={() => window.location.assign('/app')}>
              {workspaceModeText('check', locale)}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
