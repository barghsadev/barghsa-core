import { useState, useRef, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { LogOut, Settings, UserRound } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { parseSessionContext } from '../lib/session-role.js';
import { withCsrf } from '../lib/csrf.js';
import { OperatingContextSwitch } from './OperatingContextSwitch.js';

async function readAccount(response: Response) {
  if (!response.ok) throw new Error('Account unavailable');
  return parseSessionContext(await response.json());
}

export function ProfileMenu({
  area,
  locale,
  preferences,
  onOpen,
}: {
  area: 'dashboard' | 'admin';
  locale: 'fa' | 'en';
  preferences?: ReactNode;
  onOpen?: () => void;
}) {
  const account = useAsyncData('/api/auth/user', { read: readAccount });
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const submitting = useRef(false);
  const user = account.status === 'ready' ? account.data : null;
  async function logout() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(false);
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf(),
      });
      if (!response.ok) throw new Error('Logout failed');
      window.location.assign('/login');
    } catch {
      submitting.current = false;
      setPending(false);
      setError(true);
    }
  }
  const linkClass =
    'flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          account.retry();
          onOpen?.();
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={shellText('accountMenu', locale)} />
        }
      >
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground"
        >
          {user?.username ? (
            Array.from(user.username).slice(0, 2).join('').toLocaleUpperCase(locale)
          ) : (
            <UserRound className="size-4" />
          )}
        </span>
      </PopoverTrigger>
      <PopoverContent
        keepMounted
        align="end"
        className="max-h-(--available-height) w-80 max-w-[calc(100vw-2rem)] gap-4 overflow-y-auto p-4"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <div className="min-w-0 space-y-1">
          <PopoverTitle>{shellText('account', locale)}</PopoverTitle>
          {account.status === 'loading' ? (
            <p role="status" className="text-sm text-muted-foreground">
              {shellText('accountLoading', locale)}
            </p>
          ) : account.status === 'error' ? (
            <div role="alert" className="space-y-2">
              <p className="text-sm text-muted-foreground">{shellText('accountError', locale)}</p>
              <Button variant="outline" onClick={account.retry}>
                {shellText('accountRetry', locale)}
              </Button>
            </div>
          ) : (
            <>
              {user?.username && (
                <p dir="auto" className="break-words font-medium">
                  {user.username}
                </p>
              )}
              {user?.email && (
                <p dir="ltr" className="break-all text-sm text-muted-foreground">
                  {user.email}
                </p>
              )}
              {user?.mobile && (
                <p dir="ltr" className="break-all text-sm text-muted-foreground">
                  {user.mobile}
                </p>
              )}
            </>
          )}
        </div>
        <div className="space-y-2 border-t pt-3">
          <OperatingContextSwitch area={area} locale={locale} session={user} />
          {preferences}
        </div>
        <nav aria-label={shellText('account', locale)} className="space-y-1 border-t pt-3">
          <Link
            to={area === 'admin' ? '/settings/username' : '/settings/profile'}
            className={linkClass}
            onClick={() => setOpen(false)}
          >
            <UserRound className="size-4" aria-hidden="true" />
            {shellText('myProfile', locale)}
          </Link>
          <Link to="/settings" className={linkClass} onClick={() => setOpen(false)}>
            <Settings className="size-4" aria-hidden="true" />
            {shellText('settings', locale)}
          </Link>
        </nav>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {shellText('logoutError', locale)}
          </p>
        )}
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void logout()}
          className="justify-start"
        >
          <LogOut aria-hidden="true" />
          {shellText(pending ? 'logoutPending' : 'logout', locale)}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
