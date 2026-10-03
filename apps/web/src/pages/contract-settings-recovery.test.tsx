import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Templates from './AdminContractTemplatesPage.js';
import Limits from './AdminContractLimitsPage.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import {
  contractTemplate,
  contractTemplateDetail,
  templateId,
  templateVersion,
  electricityLimits,
} from '../test/contract-settings-fixtures.js';
const captured = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as ((result: unknown) => Promise<void>) | null,
  close: null as (() => void) | null,
  disabled: false,
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (v: string) => v }),
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onSuccess,
    onClose,
    confirmationDisabled,
  }: {
    action: TeamAction;
    onSuccess: (result: unknown) => Promise<void>;
    onClose: () => void;
    confirmationDisabled: boolean;
  }) => {
    captured.action = action;
    captured.success = onSuccess;
    captured.close = onClose;
    captured.disabled = confirmationDisabled;
    return <div data-testid="confirmation">{action.title}</div>;
  },
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  captured.action = null;
  captured.success = null;
  captured.close = null;
  captured.disabled = false;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
async function render(Page: typeof Templates | typeof Limits) {
  await act(async () => root.render(<Page />));
}
async function click(name: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name
  );
  expect(button, name).toBeDefined();
  await act(async () => button!.click());
}
async function fill(selector: string, value: string) {
  const node = host.querySelector<HTMLInputElement>(selector)!;
  expect(node).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector('form')?.getAttribute('aria-busy')).not.toBe('true');
  });
}
function templatesFetch(
  options: {
    list?: () => Response | Promise<Response>;
    detail?: () => Response | Promise<Response>;
  } = {}
) {
  const requests = vi.fn(async (url: RequestInfo | URL) =>
    String(url) === '/api/admin/contract-templates'
      ? (options.list?.() ?? response([contractTemplate]))
      : (options.detail?.() ?? response(contractTemplateDetail))
  );
  vi.stubGlobal('fetch', requests);
  return requests;
}
it('opening and retrying a template history never rereads the catalogue', async () => {
  let fail = true;
  const requests = templatesFetch({
    detail: () => response(contractTemplateDetail, fail ? 503 : 200),
  });
  await render(Templates);
  await click('Open');
  expect(host.textContent).toContain('Retry template history');
  fail = false;
  await click('Retry template history');
  expect(host.querySelector<HTMLInputElement>('#template-name')!.value).toBe(contractTemplate.name);
  expect(
    requests.mock.calls.filter(([u]) => String(u) === '/api/admin/contract-templates')
  ).toHaveLength(1);
});
it('independent catalogue recovery retains metadata drafts and accepted rows', async () => {
  let fail = false;
  const requests = templatesFetch({ list: () => response([contractTemplate], fail ? 503 : 200) });
  await render(Templates);
  await click('Open');
  await fill('#template-name', 'Unsaved name');
  fail = true;
  await click('Refresh');
  expect(host.textContent).toContain(contractTemplate.name);
  expect(host.querySelector<HTMLInputElement>('#template-name')!.value).toBe('Unsaved name');
  fail = false;
  const before = requests.mock.calls.filter(([u]) => String(u).endsWith(templateId)).length;
  await click('Retry template list');
  expect(host.querySelector<HTMLInputElement>('#template-name')!.value).toBe('Unsaved name');
  expect(requests.mock.calls.filter(([u]) => String(u).endsWith(templateId))).toHaveLength(before);
});
it('a new template draft survives refreshing an empty catalogue', async () => {
  templatesFetch({ list: () => response([]) });
  await render(Templates);
  await click('Add template');
  await fill('#template-name', 'New contract');
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>('#template-name')!.value).toBe('New contract');
  await submit();
  await vi.waitFor(() =>
    expect(captured.action?.body).toEqual({ name: 'New contract', description: '' })
  );
});
it('history recovery preserves prepared file content and freezes confirmation while unavailable', async () => {
  let fail = false;
  templatesFetch({ detail: () => response(contractTemplateDetail, fail ? 503 : 200) });
  await render(Templates);
  await click('Open');
  const input = host.querySelector<HTMLInputElement>('#template-file')!;
  const file = new File(['{{customer}}'], 'terms.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('{{customer}}').buffer,
  });
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Upload version');
  const body = captured.action?.body;
  fail = true;
  await click('Refresh');
  expect(captured.disabled).toBe(true);
  expect(captured.action?.body).toEqual(body);
  expect(host.textContent).toContain('terms.txt');
  fail = false;
  await click('Retry template history');
  expect(captured.disabled).toBe(false);
  expect(captured.action?.body).toEqual(body);
});
it('fresh template metadata retains local text until reset and closes confirmation', async () => {
  let changed = false;
  templatesFetch({
    detail: () =>
      response({
        ...contractTemplateDetail,
        name: changed ? 'Changed by staff' : contractTemplate.name,
      }),
  });
  await render(Templates);
  await click('Open');
  await fill('#template-name', 'Old proposal');
  await submit();
  const old = captured.success!;
  changed = true;
  await click('Refresh');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#template-name')!.value).toBe('Old proposal');
  await click('Reset to saved content');
  expect(host.querySelector<HTMLInputElement>('#template-name')!.value).toBe('Changed by staff');
  await act(async () => old({ ...contractTemplate, name: 'Old proposal' }));
  expect(host.textContent).not.toContain('Changes saved.');
});
it('fresh version history invalidates upload confirmation while retaining prepared file', async () => {
  let changed = false;
  templatesFetch({
    detail: () =>
      response(
        changed
          ? {
              ...contractTemplateDetail,
              versionCount: 1,
              latestVersion: templateVersion,
              versions: [templateVersion],
            }
          : contractTemplateDetail
      ),
  });
  await render(Templates);
  await click('Open');
  const input = host.querySelector<HTMLInputElement>('#template-file')!;
  const file = new File(['text'], 'new.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('text').buffer,
  });
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Upload version');
  changed = true;
  await click('Refresh');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  expect(host.textContent).toContain('new.txt');
  expect(host.textContent).toContain('terms.txt');
});
it('catalogue removal clears the selected editor without restoring a late detail', async () => {
  let removed = false,
    finish!: (r: Response) => void;
  templatesFetch({
    list: () => response(removed ? [] : [contractTemplate]),
    detail: () =>
      removed
        ? new Promise<Response>((done) => {
            finish = done;
          })
        : response(contractTemplateDetail),
  });
  await render(Templates);
  await click('Open');
  removed = true;
  await click('Refresh');
  await act(async () => finish(response(contractTemplateDetail)));
  expect(host.querySelector('#template-name')).toBeNull();
  expect(host.textContent).toContain('No templates yet.');
});
it.each([401, 403])(
  'history %s clears private work and defeats a late catalogue response',
  async (status) => {
    let deny = false,
      finish!: (r: Response) => void;
    templatesFetch({
      list: () =>
        deny
          ? new Promise<Response>((done) => {
              finish = done;
            })
          : response([contractTemplate]),
      detail: () => response(contractTemplateDetail, deny ? status : 200),
    });
    await render(Templates);
    await click('Open');
    await fill('#template-name', 'Private draft');
    deny = true;
    await click('Refresh');
    await act(async () => finish(response([contractTemplate])));
    expect(host.querySelector('#template-name')).toBeNull();
    expect(host.textContent).not.toContain(contractTemplate.name);
    expect(host.textContent).toContain('do not have permission');
  }
);
it('malformed history retains the editor but disables commands', async () => {
  let malformed = false;
  templatesFetch({
    detail: () =>
      response(malformed ? { ...contractTemplateDetail, versions: [{}] } : contractTemplateDetail),
  });
  await render(Templates);
  await click('Open');
  await fill('#template-name', 'Unsaved');
  malformed = true;
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>('#template-name')!.value).toBe('Unsaved');
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
});
it('new versions remove an obsolete deletion confirmation', async () => {
  let changed = false;
  templatesFetch({
    list: () =>
      response([
        {
          ...contractTemplate,
          versionCount: changed ? 1 : 0,
          latestVersion: changed ? templateVersion : null,
        },
      ]),
  });
  await render(Templates);
  await click('Delete');
  const old = captured.success!;
  changed = true;
  await click('Refresh');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  await act(async () => old({ deleted: true }));
  expect(host.textContent).not.toContain('Changes saved.');
});
it('cancelled template commands cannot clear newer edits and malformed acknowledgements are rejected', async () => {
  templatesFetch();
  await render(Templates);
  await click('Open');
  await submit();
  await vi.waitFor(() => expect(captured.close).toBeTypeOf('function'));
  const old = captured.success!;
  await act(async () => captured.close!());
  await fill('#template-name', 'Newer');
  await act(async () => old(contractTemplate));
  expect(host.querySelector<HTMLInputElement>('#template-name')!.value).toBe('Newer');
  await submit();
  await vi.waitFor(() => expect(host.querySelector('[data-testid=confirmation]')).not.toBeNull());
  await expect(captured.success!({})).rejects.toThrow('Invalid template acknowledgement');
  expect(host.querySelector('#template-name')).not.toBeNull();
});
function limitsFetch(read: () => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => read())
  );
}
it('limits retry retains edits, pauses confirmation and recovers its frozen proposal', async () => {
  let fail = false;
  limitsFetch(() => response(electricityLimits, fail ? 503 : 200));
  await render(Limits);
  await fill('#contract-limit-leadTimeDays', '14');
  await submit();
  const body = captured.action?.body;
  fail = true;
  await click('Refresh');
  expect(captured.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>('#contract-limit-leadTimeDays')!.value).toBe('14');
  fail = false;
  await click('Retry');
  expect(captured.disabled).toBe(false);
  expect(captured.action?.body).toEqual(body);
});
it('fresh limits invalidate obsolete confirmation and late completion', async () => {
  let changed = false;
  limitsFetch(() => response({ ...electricityLimits, leadTimeDays: changed ? 7 : 0 }));
  await render(Limits);
  await fill('#contract-limit-leadTimeDays', '14');
  await submit();
  const old = captured.success!;
  changed = true;
  await click('Refresh');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#contract-limit-leadTimeDays')!.value).toBe('7');
  await act(async () => old({ ...electricityLimits, leadTimeDays: 14 }));
  expect(host.textContent).not.toContain('Limits saved.');
});
it.each([401, 403])('limits %s clears drafts and recovers explicitly', async (status) => {
  let deny = false;
  limitsFetch(() => response(electricityLimits, deny ? status : 200));
  await render(Limits);
  await fill('#contract-limit-leadTimeDays', '14');
  await submit();
  deny = true;
  await click('Refresh');
  expect(host.querySelector('input')).toBeNull();
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  deny = false;
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>('#contract-limit-leadTimeDays')!.value).toBe('0');
});
it('invalid limits retain accepted form without enabling confirmation', async () => {
  let malformed = false;
  limitsFetch(() =>
    response(malformed ? { ...electricityLimits, maxContractDuration: 0 } : electricityLimits)
  );
  await render(Limits);
  await fill('#contract-limit-leadTimeDays', '14');
  malformed = true;
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>('#contract-limit-leadTimeDays')!.value).toBe('14');
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
});
it('limits validation rejects out of range local edits and unexpected acknowledgements', async () => {
  let saved = false;
  limitsFetch(() => response({ ...electricityLimits, leadTimeDays: saved ? 14 : 0 }));
  await render(Limits);
  await fill('#contract-limit-leadTimeDays', '-1');
  await submit();
  expect(captured.action).toBeNull();
  await fill('#contract-limit-leadTimeDays', '14');
  await submit();
  await vi.waitFor(() => expect(host.querySelector('[data-testid=confirmation]')).not.toBeNull());
  await expect(captured.success!({})).rejects.toThrow('Unverified catalogue acknowledgement');
  await expect(captured.success!(electricityLimits)).rejects.toThrow(
    'Unverified catalogue acknowledgement'
  );
  saved = true;
  await act(async () => captured.success!({ ...electricityLimits, leadTimeDays: 14 }));
  expect(host.textContent).toContain('Limits saved.');
});

it('reselecting the active template preserves draft without redundant reads', async () => {
  const requests = templatesFetch();
  await render(Templates);
  await click('Open');
  await fill('#template-name', 'Keep draft');
  const before = requests.mock.calls.length;
  await click('Open');
  expect(host.querySelector<HTMLInputElement>('#template-name')!.value).toBe('Keep draft');
  expect(requests.mock.calls).toHaveLength(before);
});
it('upload success preserves unrelated metadata edits', async () => {
  let uploaded = false;
  templatesFetch({
    detail: () =>
      response(
        uploaded
          ? {
              ...contractTemplateDetail,
              versionCount: 1,
              latestVersion: templateVersion,
              versions: [templateVersion],
            }
          : contractTemplateDetail
      ),
    list: () =>
      response([
        uploaded
          ? { ...contractTemplate, versionCount: 1, latestVersion: templateVersion }
          : contractTemplate,
      ]),
  });
  await render(Templates);
  await click('Open');
  await fill('#template-name', 'Unsaved metadata');
  const input = host.querySelector<HTMLInputElement>('#template-file')!;
  const file = new File(['text'], 'terms.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('text').buffer,
  });
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Upload version');
  uploaded = true;
  await act(async () => captured.success!(templateVersion));
  expect(host.querySelector<HTMLInputElement>('#template-name')!.value).toBe('Unsaved metadata');
  expect(host.textContent).toContain('Version 1');
});
it('deleting another template preserves the open metadata draft', async () => {
  const other = {
    ...contractTemplate,
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Other contract',
  };
  let removed = false;
  templatesFetch({
    list: () => response(removed ? [contractTemplate] : [contractTemplate, other]),
  });
  await render(Templates);
  await click('Open');
  await fill('#template-name', 'Keep draft');
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
  const remove = buttons.find((b) => b.getAttribute('aria-label') === 'Delete Other contract')!;
  await act(async () => remove.click());
  removed = true;
  await act(async () => captured.success!({ deleted: true }));
  expect(host.querySelector<HTMLInputElement>('#template-name')!.value).toBe('Keep draft');
});
