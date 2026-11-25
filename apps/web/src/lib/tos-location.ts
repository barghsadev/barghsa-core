import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { TosWorkspace } from '../pages/AdminTosPage.js';

export function termsVersionId(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : undefined;
}

export function useTosAddress() {
  const navigate = useNavigate();
  return useCallback<TosWorkspace['set']>(
    (patch, replace = false) => {
      const id = patch.editing || patch.publishing || patch.viewing;
      if (!id) {
        void navigate({ to: '/admin/tos', replace });
        return;
      }
      void navigate({
        to: '/admin/tos/versions/$versionId/{-$action}',
        params: {
          versionId: id,
          action: patch.publishing ? 'publish' : patch.editing && id !== 'new' ? 'edit' : undefined,
        },
        replace,
      });
    },
    [navigate]
  );
}
