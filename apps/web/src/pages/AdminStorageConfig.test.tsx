import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TeamAction } from '../components/TeamActionDialog.js';
import AdminStorageConfig from './AdminStorageConfig.js';

const harness = vi.hoisted(() => ({ action: null as TeamAction | null }));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({ action }: { action: TeamAction }) => {
    harness.action = action;
    return <div role="dialog">{action.title}</div>;
  },
}));

let container: HTMLDivElement;
let root: Root;
let cleanupPolicy: { hours: number | null; version: number };
beforeEach(() => {
  harness.action = null;
  cleanupPolicy = { hours: 24, version: 0 };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/multipart-cleanup-policy')
              ? cleanupPolicy
              : {
                  endpoint: '',
                  region: 'us-east-1',
                  bucket: 'barghsa',
                  accessKeyId: '',
                  hasSecretKey: false,
                  forcePathStyle: true,
                  privateEndpointUrl: '',
                  publicEndpointUrl: '',
                  version: 0,
                }
          )
        )
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([
  { hours: 24, version: 0 },
  { hours: null, version: 7 },
])('submits a changed multipart cleanup age from policy $hours (v$version)', async (policy) => {
  cleanupPolicy = policy;
  await act(async () => root.render(<QueryProvider>{<AdminStorageConfig />}</QueryProvider>));
  const hours = container.querySelector<HTMLInputElement>('#storage-cleanup-hours')!;
  expect(hours.value).toBe(String(policy.hours ?? ''));
  expect(container.textContent?.includes('Cleanup is paused')).toBe(policy.hours === null);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hours, '48');
    hours.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const button = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes('Save cleanup age')
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await vi.waitFor(() =>
    expect(harness.action).toMatchObject({
      method: 'PUT',
      path: '/api/admin/storage/multipart-cleanup-policy',
      body: { hours: 48, version: policy.version },
    })
  );
});
