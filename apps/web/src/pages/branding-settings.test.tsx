import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Page from './AdminBrandingConfig.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { publishedBrand, previousBrand, draftBrand } from '../test/branding-settings-fixtures.js';
import { uploadBrandingLogo } from '../lib/branding-logo-upload.js';
vi.mock('../lib/branding-logo-upload.js', () => ({ uploadBrandingLogo: vi.fn() }));
const capture = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as ((result: unknown) => Promise<void>) | null,
  close: null as (() => void) | null,
  disabled: false,
}));
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ status: 'ready', timezone: 'UTC', retry: () => {} }),
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onSuccess,
    onClose,
    confirmationDisabled,
    summary,
  }: {
    action: TeamAction;
    onSuccess: (result: unknown) => Promise<void>;
    onClose: () => void;
    confirmationDisabled: boolean;
    summary: import('react').ReactNode;
  }) => {
    capture.action = action;
    capture.success = onSuccess;
    capture.close = onClose;
    capture.disabled = confirmationDisabled;
    return <div data-testid="confirmation">{summary}</div>;
  },
}));
let host: HTMLDivElement,
  root: Root,
  current: unknown,
  history: unknown,
  fail: boolean,
  failHistory: boolean,
  denied: boolean;
beforeEach(() => {
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  current = publishedBrand;
  history = [publishedBrand, previousBrand];
  fail = false;
  failHistory = false;
  denied = false;
  capture.action = null;
  vi.mocked(uploadBrandingLogo)
    .mockReset()
    .mockImplementation(async (file) => `uploads/image/${file.name}`);
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    (file) => `blob:preview-${(file as File).name}`
  );
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const isHistory = String(url).endsWith('/configs');
      return new Response(JSON.stringify(isHistory ? history : current), {
        status: denied ? 403 : fail || (isHistory && failHistory) ? 503 : 200,
      });
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () => root.render(<QueryProvider>{<Page />}</QueryProvider>));
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === text
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
async function fill(value: string) {
  await act(async () => {
    const node = host.querySelector<HTMLInputElement>('#adminbrandingconfig-field-2')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const title = () => host.querySelector<HTMLInputElement>('#adminbrandingconfig-field-2');
const save = () =>
  [...host.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'Save Draft')!;
it('saves an independent immutable draft while retaining the published version and metadata', async () => {
  await render();
  expect(title()!.matches(':disabled')).toBe(true);
  await click('Edit');
  expect(save().disabled).toBe(true);
  await fill('Saved draft');
  await click('Save Draft');
  expect(capture.action?.body).toEqual({
    config: { ...draftBrand.config, logoDarkUrl: null },
    expectedVersion: 2,
  });
  await act(async () => capture.success!(draftBrand));
  expect(title()!.matches(':disabled')).toBe(true);
  expect(host.textContent).toContain('Published brand');
  expect(host.textContent).toContain('staff-editor');
  expect(host.textContent).toContain('Changes saved.');
  await click('View history');
  expect(host.textContent).toContain('Saved draft');
});
it('copies a superseded version into a new draft and requires a separate exact activation', async () => {
  await render();
  await click('View history');
  await click('Restore as draft');
  expect(capture.action?.body).toEqual({ config: previousBrand.config, expectedVersion: 2 });
  const restored = { ...draftBrand, config: previousBrand.config };
  await act(async () => capture.success!(restored));
  expect(host.textContent).toContain('Published brand');
  await click('Activate');
  expect(capture.action?.body).toEqual({ draftId: restored.id, expectedVersion: 3 });
  await act(async () => capture.success!({ ...restored, status: 'active' }));
  expect(host.textContent).toContain('Active version 3');
  await click('Edit');
  expect(title()!.value).toBe('Previous brand');
});
it.each([
  publishedBrand,
  { ...draftBrand, id: publishedBrand.id },
  { ...draftBrand, config: publishedBrand.config },
  { ...draftBrand, version: 9 },
])('rejects malformed, reused or mismatching saved receipts %#', async (receipt) => {
  await render();
  await click('Edit');
  await fill('Saved draft');
  await click('Save Draft');
  await expect(capture.success!(receipt)).rejects.toThrow();
  expect(title()!.value).toBe('Saved draft');
  expect(host.textContent).not.toContain('Changes saved.');
});
it('retains editing and confirmation during failed refresh, and pauses commands until recovery', async () => {
  await render();
  await click('Edit');
  await fill('Saved draft');
  await click('Save Draft');
  fail = true;
  await click('Refresh');
  expect(capture.disabled).toBe(true);
  expect(title()!.value).toBe('Saved draft');
  fail = false;
  await click('Refresh');
  expect(capture.disabled).toBe(false);
  await act(async () => capture.close!());
  expect(title()!.value).toBe('Saved draft');
});
it('requires explicit reset after a fresh saved version and ignores the old command completion', async () => {
  await render();
  await click('Edit');
  await fill('Local draft');
  await click('Save Draft');
  const old = capture.success!;
  current = draftBrand;
  history = [draftBrand, publishedBrand, previousBrand];
  await click('Refresh');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  expect(title()!.value).toBe('Local draft');
  expect(save().disabled).toBe(true);
  await act(async () =>
    old({ ...draftBrand, config: { ...draftBrand.config, appTitle: 'Local draft' } })
  );
  expect(host.textContent).not.toContain('Changes saved.');
  await click('Use latest saved settings');
  expect(title()!.value).toBe('Saved draft');
});
it('rejects incoherent current/history snapshots and keeps local work', async () => {
  await render();
  await click('Edit');
  await fill('Local draft');
  history = [draftBrand, publishedBrand, previousBrand];
  await click('Refresh');
  expect(save().disabled).toBe(true);
  expect(title()!.value).toBe('Local draft');
  expect(host.textContent).toContain('Could not verify settings history');
  const fetcher = vi.mocked(fetch);
  fetcher.mockClear();
  history = [publishedBrand, previousBrand];
  await click('Retry history');
  expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual([
    '/api/admin/branding/config',
    '/api/admin/branding/configs',
  ]);
  expect(title()!.value).toBe('Local draft');
  expect(save().disabled).toBe(false);
});
it('clears private previews and drafts on denied reads', async () => {
  await render();
  await click('Edit');
  await fill('Private draft');
  denied = true;
  await click('Refresh');
  expect(title()).toBeNull();
  expect(host.textContent).not.toContain('Private draft');
  expect(host.querySelector('[data-testid=config-preview]')).toBeNull();
  expect(host.textContent).toContain('no longer have access');
});
it('cancel editing returns to the accepted saved version without a mutation', async () => {
  await render();
  await click('Edit');
  await fill('Abandoned draft');
  await click('Cancel editing');
  expect(title()!.value).toBe('Published brand');
  expect(title()!.matches(':disabled')).toBe(true);
  expect(capture.action).toBeNull();
});

it('previews published defaults without inventing saved history', async () => {
  current = { ...publishedBrand, id: 'default', version: 0, status: 'draft' };
  history = [];
  failHistory = true;
  await render();
  expect(host.textContent).toContain('Could not verify settings history');
  expect(host.textContent).not.toContain('No saved versions yet.');
  expect(host.querySelector('[data-testid=config-preview]')).toBeNull();
  const fetcher = vi.mocked(fetch);
  fetcher.mockClear();
  failHistory = false;
  await click('Retry history');
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/admin/branding/configs']);
  expect(host.querySelector('[data-testid=config-preview]')?.textContent).toContain(
    'Published brand'
  );
  await click('View history');
  expect(host.textContent).toContain('No saved versions yet.');
  await click('Edit');
  expect(save().disabled).toBe(false);
});

async function upload(target: 'logo' | 'favicon' | 'logoDark') {
  const input = host.querySelector<HTMLInputElement>(
    target === 'logo'
      ? '#adminbrandingconfig-field-4'
      : target === 'logoDark'
        ? '#branding-dark-logo-upload'
        : '#branding-favicon-upload'
  )!;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File(['image'], `${target}.png`, { type: 'image/png' })],
  });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  return input;
}
it('keeps three verified image previews separate and accepts only their canonical saved receipt', async () => {
  await render();
  await click('Edit');
  const input = await upload('favicon');
  expect(input.value).toBe('');
  await upload('logo');
  await upload('logoDark');
  expect(host.querySelector<HTMLImageElement>('img[alt="Dark-theme logo preview"]')?.src).toBe(
    'blob:preview-logoDark.png'
  );
  expect(host.querySelector<HTMLImageElement>('img[alt="Favicon preview"]')?.src).toBe(
    'blob:preview-favicon.png'
  );
  expect(host.querySelector<HTMLImageElement>('img[alt="Logo preview"]')?.src).toBe(
    'blob:preview-logo.png'
  );
  await click('Save Draft');
  expect(capture.action?.body).toEqual({
    config: { ...publishedBrand.config, logoDarkUrl: null },
    expectedVersion: 2,
    logoDarkUploadKey: 'uploads/image/logoDark.png',
    logoUploadKey: 'uploads/image/logo.png',
    faviconUploadKey: 'uploads/image/favicon.png',
  });
  const receipt = {
    ...draftBrand,
    config: {
      ...publishedBrand.config,
      logoDarkUrl: `/api/public/branding/assets/${draftBrand.id}/${'c'.repeat(64)}`,
      logoUrl: `/api/public/branding/assets/${draftBrand.id}/${'a'.repeat(64)}`,
      faviconUrl: `/api/public/branding/assets/${draftBrand.id}/${'b'.repeat(64)}`,
    },
  };
  await expect(
    capture.success!({
      ...receipt,
      config: { ...receipt.config, faviconUrl: 'https://example.test/unconfirmed.png' },
    })
  ).rejects.toThrow('Unconfirmed branding asset');
  await expect(
    capture.success!({ ...receipt, config: { ...receipt.config, appTitle: 'Unconfirmed change' } })
  ).rejects.toThrow('Unconfirmed branding settings');
  await expect(
    capture.success!({
      ...receipt,
      config: { ...receipt.config, logoDarkUrl: 'https://example.test/unconfirmed-dark.png' },
    })
  ).rejects.toThrow('Unconfirmed branding asset');
  await act(async () => capture.success!(receipt));
  expect(host.textContent).toContain('Changes saved.');
  expect(
    host.querySelector<HTMLImageElement>('img[alt="Favicon preview"]')?.getAttribute('src')
  ).toBe(receipt.config.faviconUrl.replace('/public/', '/admin/'));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-favicon.png');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-logo.png');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-logoDark.png');
});
it('fences a pending favicon after a foreign revision and clears it only on explicit reset', async () => {
  await render();
  await click('Edit');
  await upload('favicon');
  current = draftBrand;
  history = [draftBrand, publishedBrand, previousBrand];
  await click('Refresh');
  expect(save().disabled).toBe(true);
  expect(host.querySelector('img[alt="Favicon preview"]')).not.toBeNull();
  await click('Use latest saved settings');
  expect(host.querySelector('img[alt="Favicon preview"]')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-favicon.png');
});
it('drops a pending favicon when its URL is edited and clears private previews on denial', async () => {
  await render();
  await click('Edit');
  await upload('favicon');
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('#adminbrandingconfig-field-5')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'https://example.test/favicon.png'
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Save Draft');
  expect(capture.action?.body).not.toHaveProperty('faviconUploadKey');
  await act(async () => capture.close!());
  await upload('favicon');
  denied = true;
  await click('Refresh');
  expect(host.querySelector('img[alt="Favicon preview"]')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-favicon.png');
});

it('preserves a legacy fixed theme while editing an unrelated field', async () => {
  const legacy = { ...publishedBrand.config, darkMode: true };
  delete legacy.themeMode;
  current = { ...publishedBrand, config: legacy };
  history = [current, previousBrand];
  await render();
  await click('Edit');
  await fill('Legacy title');
  await click('Save Draft');
  expect(capture.action?.body).toEqual({
    config: { ...legacy, appTitle: 'Legacy title', themeMode: 'dark', logoDarkUrl: null },
    expectedVersion: 2,
  });
});
