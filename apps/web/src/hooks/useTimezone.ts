import { useCallback, useEffect, useState } from 'react';

/** Load the account preference. A failed read is never treated as a saved default. */
export function useTimezone() {
  const [timezone, setTimezone] = useState('Asia/Tehran');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    void fetch('/api/user/settings/timezone', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Timezone unavailable');
        const data: unknown = await response.json();
        if (
          !data ||
          typeof data !== 'object' ||
          !('timezone' in data) ||
          typeof data.timezone !== 'string' ||
          !data.timezone
        ) {
          throw new Error('Invalid timezone response');
        }
        new Intl.DateTimeFormat('en', { timeZone: data.timezone });
        if (!controller.signal.aborted) {
          setTimezone(data.timezone);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    window.addEventListener('barghsa:timezone-changed', retry);
    return () => window.removeEventListener('barghsa:timezone-changed', retry);
  }, [retry]);
  return { timezone, status, retry };
}
