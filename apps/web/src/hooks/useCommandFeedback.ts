import { useEffect, useRef } from 'react';
import { useAccountUser } from './useAccountUser.js';
import { useLocale } from './useLocale.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { toast } from '../lib/toast-api.js';

/** Intercept the domain's validated result, after its receipt and current-owner checks. */
export function useCommandFeedback({
  success = null,
  error = null,
  operation,
}: {
  success?: string | null;
  error?: string | null;
  operation?: string | undefined;
}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const locale = useLocale();
  const scope = JSON.stringify([actor, revision, locale, operation]);
  const live = useRef(scope);
  live.current = scope;
  const previous = useRef({ scope, success: null as string | null, error: null as string | null });
  const armed = useRef(true);
  useEffect(() => {
    if (live.current !== scope) return;
    const before = previous.current;
    previous.current = { scope, success, error };
    if (before.scope !== scope) {
      armed.current = false;
      return;
    }
    if (!success && !error) armed.current = true;
    if (!armed.current) return;
    if (error) {
      if (error !== before.error) toast.error(error);
    } else if (success && success !== before.success) toast.success(success);
  }, [scope, success, error]);
}
