import { useEffect, useRef, useState } from 'react';
import { withCsrf } from '../lib/csrf.js';

type RouteErrorCode = 'CHUNK_LOAD_FAILED' | 'ROUTE_RENDER_FAILED';

function sendRouteError(code: RouteErrorCode, reference: string) {
  void fetch('/api/route-errors', {
    method: 'POST',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ code, reference }),
    keepalive: true,
    mode: 'same-origin',
    referrerPolicy: 'origin',
  }).catch(() => {
    // Recovery is still available when the reporting endpoint is down.
  });
}

export default function reportEmergencyRouteError() {
  sendRouteError('CHUNK_LOAD_FAILED', crypto.randomUUID());
}

export function useRouteErrorReport(code: RouteErrorCode) {
  const [reference] = useState(() => crypto.randomUUID());
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    sendRouteError(code, reference);
  }, [code, reference]);
  return reference;
}
