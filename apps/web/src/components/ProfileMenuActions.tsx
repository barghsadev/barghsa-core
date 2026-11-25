import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { LogOut, Settings, UserRound } from 'lucide-react';
import { Button } from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import { t } from '@barghsa/i18n/workspace';
import { withCsrf } from '../lib/csrf.js';

const linkClass =
  'flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export default function ProfileMenuActions({
  area,
  locale,
  onClose,
  onIdentity,
}: {
  area: 'dashboard' | 'admin';
  locale: 'fa' | 'en';
  onClose: () => void;
  onIdentity: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const submitting = useRef(false);
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
  return (
    <>
      <nav aria-label={shellText('account', locale)} className="space-y-1 border-t pt-3">
        <Button variant="ghost" className="w-full justify-start" onClick={onIdentity}>
          <UserRound aria-hidden="true" />
          {t('conversationIdentity.title', locale)}
        </Button>
        <Link
          to={area === 'admin' ? '/settings/username' : '/settings/profile'}
          className={linkClass}
          onClick={onClose}
        >
          <UserRound className="size-4" aria-hidden="true" />
          {shellText('myProfile', locale)}
        </Link>
        <Link to="/settings" className={linkClass} onClick={onClose}>
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
    </>
  );
}
