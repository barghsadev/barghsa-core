import { useEffect, useState } from 'react';
import { useAccountUser } from './useAccountUser.js';
import { useOwnedDocumentRead } from './useOwnedDocumentRead.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { DocumentRequestError } from '../lib/documents.js';

export const documentIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function useCustomerDocumentProfile(enabled = true) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const read = useOwnedDocumentRead(actor, revision, false, undefined, 'document-profiles');
  const scope = JSON.stringify([actor, revision]);
  const [attempt, setAttempt] = useState(0);
  const [profile, setProfile] = useState<{
    scope: string;
    id: string | null;
    state: 'loading' | 'ready' | 'missing' | 'error' | 'denied';
  }>({ scope, id: null, state: 'loading' });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setProfile({ scope, id: null, state: 'loading' });
    void read<{ activeProfileId: string | null }>('/api/profiles', { signal: controller.signal })
      .then(({ activeProfileId }) => {
        if (controller.signal.aborted) return;
        if (
          activeProfileId !== null &&
          (typeof activeProfileId !== 'string' || !documentIdPattern.test(activeProfileId))
        )
          throw new Error('Invalid active profile');
        setProfile({ scope, id: activeProfileId, state: activeProfileId ? 'ready' : 'missing' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const denied = error instanceof DocumentRequestError && [401, 403].includes(error.status);
        setProfile({ scope, id: null, state: denied ? 'denied' : 'error' });
      });
    return () => controller.abort();
  }, [enabled, scope, attempt, read]);

  return {
    id: profile.scope === scope ? profile.id : null,
    state: profile.scope === scope ? profile.state : ('loading' as const),
    retry: () => setAttempt((value) => value + 1),
  };
}
