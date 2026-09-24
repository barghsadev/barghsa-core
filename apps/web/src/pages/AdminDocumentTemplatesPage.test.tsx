import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TeamAction } from '../components/TeamActionDialog.js';
import AdminDocumentTemplatesPage from './AdminDocumentTemplatesPage.js';

const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  action: null as TeamAction | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({ action }: { action: TeamAction }) => {
    harness.action = action;
    return <div role="dialog">{action.title}</div>;
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
  await act(async () => root.render(<AdminDocumentTemplatesPage />));
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(text)
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}

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
