import { lazy, Suspense, useEffect, useState } from 'react';
import { takeAuthSuccess } from '../lib/auth-entry-feedback.js';
import { onToastRequested, toast } from '../lib/toast-api.js';

const SonnerToaster = lazy(() => import('./SonnerToaster.js'));

export function ApplicationToaster() {
  const [active, setActive] = useState(false);

  useEffect(() => onToastRequested(() => setActive(true)), []);
  useEffect(() => {
    const message = takeAuthSuccess();
    if (message) toast.success(message);
  }, []);
  return active ? (
    <Suspense fallback={null}>
      <SonnerToaster />
    </Suspense>
  ) : null;
}
