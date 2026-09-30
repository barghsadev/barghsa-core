import { useEffect, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Button } from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import { withCsrf } from '../lib/csrf.js';
import { readSessionContext, type SessionContext } from '../lib/session-role.js';

export function OperatingContextSwitch({
  area,
  locale,
  session,
}: {
  area: 'dashboard' | 'admin';
  locale: 'fa' | 'en';
  session?: SessionContext | null;
}) {
  const [canSwitch, setCanSwitch] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const current = area === 'admin' ? 'staff' : 'customer';
  const target = current === 'staff' ? 'customer' : 'staff';

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

  async function switchContext() {
    setPending(true);
    setError(false);
    try {
      const response = await fetch('/api/auth/sessions/context', {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ context: target }),
      });
      if (!response.ok) throw new Error('Context switch failed');
      window.location.assign('/app');
    } catch {
      setError(true);
      setPending(false);
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
          disabled={pending}
          onClick={() => void switchContext()}
          aria-label={shellText(target === 'staff' ? 'switchToStaff' : 'switchToCustomer', locale)}
        >
          <ArrowLeftRight className="size-4" aria-hidden="true" />
          <span className="inline">
            {shellText(target === 'staff' ? 'switchToStaff' : 'switchToCustomer', locale)}
          </span>
        </Button>
      ) : null}
      {error ? (
        <span
          role="alert"
          className="absolute top-full z-20 mt-1 rounded-md border bg-card p-2 text-xs text-destructive shadow-sm"
        >
          {shellText('contextSwitchError', locale)}
        </span>
      ) : null}
    </div>
  );
}
