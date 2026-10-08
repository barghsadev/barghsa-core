import { notifyManager } from '@tanstack/react-query';
import { beforeEach, afterEach } from 'vitest';

// Let React's async act flush query notifications with the mocked fetch promises.
beforeEach(() => notifyManager.setScheduler(queueMicrotask));
afterEach(() => notifyManager.setScheduler((notify) => setTimeout(notify, 0)));
export { QueryProvider } from '../providers/QueryProvider.js';
