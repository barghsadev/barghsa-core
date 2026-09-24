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
beforeEach(() => {
  harness.action = null;
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
              ? { hours: 24, version: 0 }
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

it('submits a changed multipart cleanup age with its configuration version', async () => {
  await act(async () => root.render(<AdminStorageConfig />));
  const hours = container.querySelector<HTMLInputElement>('#storage-cleanup-hours')!;
  expect(hours.value).toBe('24');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hours, '48');
    hours.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const button = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes('Save cleanup age')
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(harness.action).toMatchObject({
    method: 'PUT',
    path: '/api/admin/storage/multipart-cleanup-policy',
    body: { hours: 48, version: 0 },
  });
});
