import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Storage from './AdminStorageConfig.js';
import Policies from './AdminUploadPoliciesPage.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { policyLimit, uploadPolicy } from '../test/policy-catalogue-fixtures.js';
import type { StorageConfigView } from '../lib/storage-policy-form.js';
type SchemaModule = typeof import('../lib/catalogue-form-schemas.js');
const harness = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as ((result: unknown) => Promise<void>) | null,
  close: null as (() => void) | null,
  unconfirmed: null as (() => void) | null,
  fields: null as ((fields: unknown[]) => boolean) | null,
  pending: null as ((value: boolean) => void) | null,
  disabled: false,
  fail: false,
  hold: false,
  release: null as (() => void) | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (v: string) => v }),
}));
vi.mock('../lib/catalogue-form-schemas.js', async (original) => {
  const actual = await original<SchemaModule>();
  return {
    ...actual,
    contentFormSchema: async (...args: Parameters<typeof actual.contentFormSchema>) => {
      if (harness.fail) throw new Error('Unavailable validator');
      if (harness.hold)
        await new Promise<void>((done) => {
          harness.release = done;
        });
      return actual.contentFormSchema(...args);
    },
  };
});
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: {
    action: TeamAction;
    onSuccess: (result: unknown) => Promise<void>;
    onClose: () => void;
    onUnconfirmed?: () => void;
    onValidationError?: (fields: unknown[]) => boolean;
    onPendingChange?: (value: boolean) => void;
    confirmationDisabled: boolean;
  }) => {
    harness.action = props.action;
    harness.success = props.onSuccess;
    harness.close = () => {
      harness.action = null;
      props.onClose();
    };
    harness.unconfirmed = props.onUnconfirmed ?? null;
    harness.fields = props.onValidationError ?? null;
    harness.pending = props.onPendingChange ?? null;
    harness.disabled = props.confirmationDisabled;
    return <div role="dialog">{props.action.title}</div>;
  },
}));
const saved: StorageConfigView = {
  endpoint: 'https://objects.example.test',
  region: 'us-east-1',
  bucket: 'documents',
  accessKeyId: 'stored-key',
  hasSecretKey: true,
  forcePathStyle: true,
  privateEndpointUrl: '',
  publicEndpointUrl: '',
  version: 7,
};
let config: StorageConfigView,
  cleanup: { hours: number; version: number },
  policies: (typeof uploadPolicy)[],
  limits: (typeof policyLimit)[],
  failRead: boolean,
  denied: boolean;
let host: HTMLDivElement, root: Root, requests: ReturnType<typeof vi.fn>;
beforeEach(() => {
  document.documentElement.lang = 'en';
  config = { ...saved };
  cleanup = { hours: 24, version: 3 };
  policies = [{ ...uploadPolicy }];
  limits = [{ ...policyLimit }];
  failRead = false;
  denied = false;
  Object.assign(harness, {
    action: null,
    success: null,
    close: null,
    unconfirmed: null,
    fields: null,
    pending: null,
    fail: false,
    hold: false,
    release: null,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  requests = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    const value = path.endsWith('/config')
      ? config
      : path.endsWith('/multipart-cleanup-policy')
        ? cleanup
        : path.endsWith('/access')
          ? { canEdit: !denied }
          : path.endsWith('/limits')
            ? limits
            : policies;
    return new Response(JSON.stringify(value), { status: denied ? 403 : failRead ? 503 : 200 });
  });
  vi.stubGlobal('fetch', requests);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(domain: 'storage' | 'cleanup' | 'policy') {
  await act(async () =>
    root.render(<QueryProvider>{domain === 'policy' ? <Policies /> : <Storage />}</QueryProvider>)
  );
  if (domain === 'policy') await click('Edit');
}
const field = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
async function fill(id: string, value: string) {
  const node = field(id);
  expect(node).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
async function submit(domain: 'storage' | 'cleanup' | 'policy') {
  const id =
    domain === 'storage'
      ? 'storage-bucket'
      : domain === 'cleanup'
        ? 'storage-cleanup-hours'
        : 'upload-policy-size';
  await act(async () =>
    field(id)
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function proposal() {
  await vi.waitFor(() => expect(harness.action).not.toBeNull());
  return harness.action!;
}
async function settle() {
  await act(async () => {});
}
it('storage validates origins and retains its secret and companion fields', async () => {
  await mount('storage');
  await fill('storage-secret', 'local-secret');
  await fill('storage-endpoint', 'https://private:token@example.test/path');
  await submit('storage');
  await vi.waitFor(async () => {
    await settle();
    expect(document.activeElement).toBe(field('storage-endpoint'));
  });
  expect(field('storage-bucket').value).toBe('documents');
  expect(field('storage-secret').value).toBe('local-secret');
  expect(harness.action).toBeNull();
  expect(field('storage-endpoint').getAttribute('aria-invalid')).toBe('true');
});
it('storage requires secret re-entry for a changed location and captures the replacement', async () => {
  await mount('storage');
  await fill('storage-bucket', 'new-location');
  await submit('storage');
  await vi.waitFor(async () => {
    await settle();
    expect(document.activeElement).toBe(field('storage-secret'));
  });
  await fill('storage-secret', 'replacement');
  await submit('storage');
  expect((await proposal()).body).toMatchObject({
    bucket: 'new-location',
    version: 7,
    secretAccessKey: 'replacement',
  });
  expect(host.textContent).not.toContain('replacement');
});
it('clearing a stored secret requires clearing its access key, without losing other entries', async () => {
  await mount('storage');
  await act(async () => field('storage-clear-secret').click());
  await submit('storage');
  await vi.waitFor(async () => {
    await settle();
    expect(document.activeElement).toBe(field('storage-accessKeyId'));
  });
  await fill('storage-accessKeyId', '');
  await submit('storage');
  expect((await proposal()).body).toMatchObject({
    accessKeyId: '',
    secretAccessKey: '',
    bucket: 'documents',
  });
});
it('cleanup enforces whole bounded hours without clearing a storage draft', async () => {
  await mount('cleanup');
  await fill('storage-secret', 'retained-secret');
  await fill('storage-cleanup-hours', '1.5');
  await submit('cleanup');
  await vi.waitFor(async () => {
    await settle();
    expect(document.activeElement).toBe(field('storage-cleanup-hours'));
  });
  expect(field('storage-secret').value).toBe('retained-secret');
  await fill('storage-cleanup-hours', '48');
  await submit('cleanup');
  expect((await proposal()).body).toEqual({ hours: 48, version: 3 });
});
it.each(['storage', 'cleanup', 'policy'] as const)(
  '%s retains entries when validation cannot load and retries',
  async (domain) => {
    await mount(domain);
    const id =
      domain === 'storage'
        ? 'storage-secret'
        : domain === 'cleanup'
          ? 'storage-cleanup-hours'
          : 'upload-policy-size';
    await fill(id, domain === 'storage' ? 'retained-secret' : '1');
    harness.fail = true;
    await submit(domain);
    await vi.waitFor(() =>
      expect(host.textContent + document.body.textContent).toContain('Validation could not load')
    );
    expect(harness.action).toBeNull();
    expect(field(id).value).toBe(domain === 'storage' ? 'retained-secret' : '1');
    harness.fail = false;
    await submit(domain);
    await proposal();
  }
);
it.each(['storage', 'cleanup', 'policy'] as const)(
  '%s locks deferred validation and ignores completion after refresh',
  async (domain) => {
    await mount(domain);
    harness.hold = true;
    await submit(domain);
    await vi.waitFor(() => expect(harness.release).toBeTypeOf('function'));
    expect(
      field(
        domain === 'storage'
          ? 'storage-bucket'
          : domain === 'cleanup'
            ? 'storage-cleanup-hours'
            : 'upload-policy-size'
      ).matches(':disabled')
    ).toBe(true);
    await submit(domain);
    await click('Refresh');
    await act(async () => harness.release!());
    expect(harness.action).toBeNull();
  }
);
it('storage keeps local credentials through a failed read and changed settings until explicit reset', async () => {
  await mount('storage');
  await fill('storage-secret', 'retained-secret');
  failRead = true;
  await click('Refresh');
  expect(field('storage-secret').value).toBe('retained-secret');
  expect(field('storage-bucket').matches(':disabled')).toBe(true);
  failRead = false;
  config = { ...saved, bucket: 'server-location', version: 8 };
  await click('Try again');
  await vi.waitFor(() => expect(host.textContent).toContain('saved settings changed'));
  expect(field('storage-bucket').value).toBe('documents');
  expect(field('storage-secret').value).toBe('retained-secret');
  await click('Reset to saved settings');
  expect(field('storage-bucket').value).toBe('server-location');
  expect(field('storage-secret').value).toBe('');
});
it.each(['storage', 'cleanup', 'policy'] as const)(
  '%s returns owned server fields to its editor without clearing companions',
  async (domain) => {
    await mount(domain);
    if (domain === 'storage') await fill('storage-secret', 'retained-secret');
    await submit(domain);
    await proposal();
    const owner = domain === 'storage' ? 'bucket' : domain === 'cleanup' ? 'hours' : 'maxSizeBytes';
    await act(async () => {
      expect(harness.fields!([owner])).toBe(true);
      harness.close!();
    });
    const id =
      domain === 'storage'
        ? 'storage-bucket'
        : domain === 'cleanup'
          ? 'storage-cleanup-hours'
          : 'upload-policy-size';
    await vi.waitFor(async () => {
      await settle();
      expect(document.activeElement).toBe(field(id));
    });
    expect(field(id).getAttribute('aria-invalid')).toBe('true');
    if (domain === 'storage') expect(field('storage-secret').value).toBe('retained-secret');
    if (domain === 'policy')
      expect(
        document.querySelector<HTMLInputElement>('fieldset input[type=checkbox]')!.checked
      ).toBe(true);
  }
);
it.each(['storage', 'cleanup', 'policy'] as const)(
  '%s freezes an unmatched receipt until fresh read and explicit reset',
  async (domain) => {
    await mount(domain);
    await submit(domain);
    await proposal();
    const complete = harness.success!;
    await expect(complete({})).rejects.toThrow();
    await act(async () => harness.unconfirmed!());
    await vi.waitFor(() => expect(harness.disabled).toBe(true));
    await act(async () => harness.close!());
    await submit(domain);
    expect(document.querySelector('[role=dialog]')?.textContent).not.toBe(
      domain === 'policy' ? 'Save policy' : 'Save and activate'
    );
    await click('Refresh');
    await click('Reset to saved settings');
    await submit(domain);
    await proposal();
  }
);
it('protected confirmation prevents refresh while its command is pending', async () => {
  await mount('storage');
  await submit('storage');
  await proposal();
  const count = requests.mock.calls.length;
  await act(async () => harness.pending!(true));
  await click('Refresh');
  expect(requests.mock.calls).toHaveLength(count);
  await act(async () => harness.pending!(false));
  await click('Refresh');
  expect(requests.mock.calls.length).toBeGreaterThan(count);
});
it('read denial clears private drafts and ignores an obsolete successful command', async () => {
  await mount('storage');
  await fill('storage-secret', 'private-secret');
  await submit('storage');
  await proposal();
  const complete = harness.success!;
  denied = true;
  await click('Refresh');
  await act(async () => complete({ ...saved, version: 8 }));
  expect(field('storage-secret')).toBeNull();
  expect(host.textContent).not.toContain('Configuration saved');
  expect(host.textContent).not.toContain('private-secret');
});
it('policy focuses the format group and preserves a selected format when byte limits fail', async () => {
  await mount('policy');
  const checkboxes = [
    ...document.querySelectorAll<HTMLInputElement>('fieldset input[type=checkbox]'),
  ];
  await act(async () => checkboxes.filter((node) => node.checked).forEach((node) => node.click()));
  await fill('upload-policy-size', '1');
  await submit('policy');
  await vi.waitFor(async () => {
    await settle();
    expect(document.activeElement).toBe(checkboxes[0]);
  });
  await act(async () => checkboxes[0]!.click());
  await fill('upload-policy-size', '0.0000001');
  await submit('policy');
  await vi.waitFor(async () => {
    await settle();
    expect(document.activeElement).toBe(field('upload-policy-size'));
  });
  expect(checkboxes[0]!.checked).toBe(true);
});
it('policy captures an exact single-byte limit without rounding up or losing formats', async () => {
  await mount('policy');
  await fill('upload-policy-size', String(1 / 1048576));
  await submit('policy');
  expect((await proposal()).body).toMatchObject({
    category: 'document',
    allowedExtensions: ['.pdf'],
    maxSizeBytes: 1,
  });
});
