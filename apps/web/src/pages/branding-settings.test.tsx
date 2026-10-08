import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Page from './AdminBrandingConfig.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { publishedBrand, previousBrand, draftBrand } from '../test/branding-settings-fixtures.js';
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
  denied: boolean;
beforeEach(() => {
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  current = publishedBrand;
  history = [publishedBrand, previousBrand];
  fail = false;
  denied = false;
  capture.action = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: RequestInfo | URL) =>
        new Response(JSON.stringify(String(url).endsWith('/configs') ? history : current), {
          status: denied ? 403 : fail ? 503 : 200,
        })
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
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
  await fill('Saved draft');
  await click('Save Draft');
  expect(capture.action?.body).toEqual({ config: draftBrand.config, expectedVersion: 2 });
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
  await render();
  expect(host.querySelector('[data-testid=config-preview]')?.textContent).toContain(
    'Published brand'
  );
  await click('View history');
  expect(host.textContent).toContain('No saved versions yet.');
  await click('Edit');
  expect(save().disabled).toBe(false);
});
