import { useEffect, useState, type ReactNode } from 'react';
import { createServerQueryClient } from '../lib/server-query-client.js';
import { QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { beforeEach, afterEach } from 'vitest';

// Let React's async act flush query notifications with the mocked fetch promises.
beforeEach(() => notifyManager.setScheduler(queueMicrotask));
afterEach(() => notifyManager.setScheduler((notify) => setTimeout(notify, 0)));
export { QueryProvider } from '../providers/QueryProvider.js';

/** Exercise component-owned scope fences without remounting the surrounding application. */
export function QueryComponentProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createServerQueryClient);
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
