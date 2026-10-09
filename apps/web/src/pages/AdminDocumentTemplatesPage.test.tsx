import { QueryComponentProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TeamAction } from '../components/TeamActionDialog.js';
import AdminDocumentTemplatesPage from './AdminDocumentTemplatesPage.js';

const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  action: null as TeamAction | null,
  dialog: null as null | {
    onClose: () => void;
    onSuccess: (result: unknown) => Promise<void>;
    onUnconfirmed: () => void;
    onDenied: () => void;
    onValidationError: (fields: unknown[]) => boolean;
  },
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: NonNullable<typeof harness.dialog> & { action: TeamAction }) => {
    harness.action = props.action;
    harness.dialog = props;
    return <div role="dialog">{props.action.title}</div>;
  },
}));

const TEMPLATE = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const DOCX = '33333333-3333-4333-8333-333333333333';
const PDF = '44444444-4444-4444-8444-444444444444';
const list = [
  {
    id: TEMPLATE,
    title: 'Customer agreement',
    description: 'Staff form',
    category: 'contract',
    versionCount: 1,
    updatedAt: '2026-09-24T00:00:00Z',
  },
];
const detail = {
  ...list[0],
  versions: [
    {
      id: VERSION,
      versionNumber: 1,
      changeSummary: 'Initial terms',
      createdAt: '2026-09-24T00:00:00Z',
      placeholders: ['customerName'],
      missingRequired: ['date', 'contractNumber'],
      conflicts: [
        {
          name: 'customerName',
          files: [
            { fileName: 'terms.docx', context: 'Buyer {{customerName}}' },
            { fileName: 'terms.pdf', context: 'Recipient {{customerName}}' },
          ],
        },
      ],
      files: [
        {
          id: DOCX,
          originalName: 'terms.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sizeBytes: 100,
          checksum: 'a'.repeat(64),
          placeholders: [],
        },
        {
          id: PDF,
          originalName: 'terms.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 200,
          checksum: 'b'.repeat(64),
          placeholders: [],
        },
      ],
    },
  ],
};
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  harness.locale = 'en';
  harness.action = null;
  harness.dialog = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url.includes(`/${TEMPLATE}`) ? response(detail) : response(list)))
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render() {
  await act(async () =>
    root.render(<QueryComponentProvider>{<AdminDocumentTemplatesPage />}</QueryComponentProvider>)
  );
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(text)
  );
  expect(button, text).toBeDefined();
  await act(async () => {
    button!.click();
    await vi.dynamicImportSettled();
  });
}

async function fill(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.dynamicImportSettled();
  });
}
async function submit(selector: string) {
  await act(async () => {
    container
      .querySelector(selector)!
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
}

it('validates whitespace titles, retains raw values after server errors and focuses the owned field', async () => {
  await render();
  await click('Add template');
  await fill('#document-template-title', '   ');
  await submit('#document-template-title');
  expect(harness.action).toBeNull();
  expect(container.querySelector('#document-template-title')!.getAttribute('aria-invalid')).toBe(
    'true'
  );
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(container.querySelector('#document-template-title'))
  );
  await fill('#document-template-title', ' Raw template ');
  await fill('#document-template-description', ' Raw description ');
  await submit('#document-template-title');
  expect(harness.action!.body).toEqual({
    title: 'Raw template',
    description: 'Raw description',
    category: 'general',
  });
  await act(async () => {
    expect(harness.dialog!.onValidationError(['title', 'secret-value'])).toBe(true);
    harness.dialog!.onClose();
  });
  expect(container.querySelector<HTMLInputElement>('#document-template-title')!.value).toBe(
    ' Raw template '
  );
  expect(
    container.querySelector<HTMLTextAreaElement>('#document-template-description')!.value
  ).toBe(' Raw description ');
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(container.querySelector('#document-template-title'))
  );
  expect(container.textContent).not.toContain('secret-value');
  await fill('#document-template-title', ' Corrected template ');
  await submit('#document-template-title');
  expect(harness.action!.body).toMatchObject({ title: 'Corrected template' });
});

it('locks companion version commands and immutable metadata before asynchronous validation finishes', async () => {
  await render();
  await click('Customer agreement');
  await click('Edit template');
  await fill('#document-template-title', ' Captured title ');
  await act(async () => {
    const metadata = container.querySelector('#document-template-title')!.closest('form')!;
    const version = container.querySelector('#document-template-files')!.closest('form')!;
    for (const form of [metadata, version, metadata])
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
  expect(harness.action!.path).toBe(`/api/admin/document-templates/${TEMPLATE}`);
  await fill('#document-template-title', 'Retired programmatic event');
  expect(harness.action!.body).toMatchObject({ title: 'Captured title' });
  expect(container.querySelector<HTMLInputElement>('#document-template-files')!.disabled).toBe(
    true
  );
  expect(container.querySelector<HTMLButtonElement>('header button')!.disabled).toBe(true);
  await act(async () => harness.dialog!.onClose());
  expect(container.querySelector<HTMLInputElement>('#document-template-title')!.value).toBe(
    ' Captured title '
  );
});

it('keeps drafts after an unconfirmed save, permits only read recovery, and requires deliberate editing', async () => {
  await render();
  await click('Customer agreement');
  await click('Edit template');
  await fill('#document-template-title', ' Unsure title ');
  await fill('#document-template-summary', ' Retained companion summary ');
  await submit('#document-template-title');
  await expect(harness.dialog!.onSuccess({ ...detail, title: 'Wrong receipt' })).rejects.toThrow();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response({}, 503))
  );
  await act(async () => harness.dialog!.onUnconfirmed());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector<HTMLInputElement>('#document-template-title')!.value).toBe(
    ' Unsure title '
  );
  expect(container.querySelector<HTMLInputElement>('#document-template-summary')!.value).toBe(
    ' Retained companion summary '
  );
  await submit('#document-template-title');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(
    [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Reviewed;')
    )!.disabled
  ).toBe(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url.includes(`/${TEMPLATE}`) ? response(detail) : response(list)))
  );
  await click('Refresh');
  await click('Reviewed; return to editing');
  await submit('#document-template-title');
  expect(harness.action!.body).toMatchObject({ title: 'Unsure title' });
});

it('rejects empty file selection and duplicate retained/new names with linked input focus', async () => {
  await render();
  await click('Customer agreement');
  for (const box of container.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]'))
    await act(async () => box.click());
  await submit('#document-template-files');
  expect(harness.action).toBeNull();
  expect(container.querySelector('#document-template-files')!.getAttribute('aria-invalid')).toBe(
    'true'
  );
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(container.querySelector('#document-template-files'))
  );
  await act(async () => container.querySelector<HTMLInputElement>('fieldset input')!.click());
  const input = container.querySelector<HTMLInputElement>('#document-template-files')!;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File(['new'], 'TERMS.DOCX')],
  });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.dynamicImportSettled();
  });
  await submit('#document-template-files');
  expect(harness.action).toBeNull();
});

it('accepts the actual template receipt for a new version and retains historical files', async () => {
  await render();
  await click('Customer agreement');
  await fill('#document-template-summary', ' New summary ');
  await submit('#document-template-files');
  const saved = {
    ...detail,
    versionCount: 2,
    versions: [
      {
        ...detail.versions[0]!,
        id: '55555555-5555-4555-8555-555555555555',
        versionNumber: 2,
        changeSummary: 'New summary',
      },
      ...detail.versions,
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url.includes(`/${TEMPLATE}`) ? response(saved) : response(list)))
  );
  await act(async () => harness.dialog!.onSuccess(saved));
  expect(container.textContent).toContain('Changes saved');
  expect(container.textContent).toContain('Initial terms');
  expect(container.querySelector<HTMLInputElement>('#document-template-summary')!.value).toBe('');
});

it('builds the next version from selected old files and new PDF files', async () => {
  await render();
  await click('Customer agreement');
  expect(container.textContent).toContain('Required placeholders missing');
  expect(container.textContent).toContain('Placeholder context conflicts');
  const boxes = [
    ...container.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]'),
  ];
  expect(boxes).toHaveLength(2);
  await act(async () => boxes[1]!.click());
  const input = container.querySelector<HTMLInputElement>('#document-template-files')!;
  const replacement = new File(['%PDF-1.7'], 'terms.pdf', { type: 'application/pdf' });
  Object.defineProperty(input, 'files', { configurable: true, value: [replacement] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await click('Create new version');
  expect(harness.action).toMatchObject({
    method: 'POST',
    path: `/api/admin/document-templates/${TEMPLATE}/versions`,
  });
  const form = harness.action!.body as FormData;
  expect(form.get('retainedFileIds')).toBe(JSON.stringify([DOCX]));
  expect((form.get('files') as File).name).toBe('terms.pdf');
});

it('shows the Persian page and a clear permission denial', async () => {
  harness.locale = 'fa';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response({ error: 'forbidden' }, 403))
  );
  await render();
  expect(container.querySelector('section')?.getAttribute('dir')).toBe('rtl');
  expect(container.textContent).toContain('قالب‌های اسناد');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('اجازه');
});
