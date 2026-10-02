import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { FileUpload, type FileUploadProgress } from './FileUpload.js';
import type { FileUploadPolicy } from '../lib/file-upload.js';
import { documentText } from '@barghsa/i18n/documents';
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: (locale: string) => ({
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', options).format(value),
  }),
}));
const policy = {
  formats: [{ extension: '.pdf', mimeTypes: ['application/pdf'] }],
  maxSizeBytes: 1048576,
};
const file = new File(['pdf'], 'proof.pdf', { type: 'application/pdf' });
let host: HTMLDivElement, root: Root;
const changed = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  changed.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function Picker({
  locale = 'en',
  initial = [],
  rules = policy,
  maxFiles = 1,
  disabled = false,
  progress,
}: {
  locale?: 'en' | 'fa';
  initial?: File[];
  rules?: FileUploadPolicy | null;
  maxFiles?: number;
  disabled?: boolean;
  progress?: readonly (FileUploadProgress & { file: File })[];
}) {
  const [files, setFiles] = useState(initial);
  return (
    <FileUpload
      value={files}
      onChange={(next) => {
        changed(next);
        setFiles(next);
      }}
      policy={rules}
      locale={locale}
      maxFiles={maxFiles}
      disabled={disabled}
      {...(progress ? { progress } : {})}
    />
  );
}
async function drop(files: File[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  await act(async () => host.querySelector('button')!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
}
for (const locale of ['en', 'fa'] as const)
  it(`provides localized browse/drop rules and removable selected metadata (${locale})`, async () => {
    await act(async () => root.render(<Picker locale={locale} />));
    expect(host.textContent).toContain(documentText('dropFiles', locale));
    expect(host.textContent).toContain('.pdf');
    const input = host.querySelector<HTMLInputElement>('input')!;
    expect(input.accept).toBe('.pdf');
    const open = vi.spyOn(input, 'click');
    await act(async () => host.querySelector('button')!.click());
    expect(open).toHaveBeenCalledOnce();
    await drop([file]);
    expect(host.textContent).toContain('proof.pdf');
    expect(changed).toHaveBeenLastCalledWith([file]);
    await act(async () => host.querySelectorAll('button')[1]!.click());
    expect(host.textContent).not.toContain('proof.pdf');
    expect(changed).toHaveBeenLastCalledWith([]);
    expect(document.activeElement).toBe(host.querySelector('button'));
  });
it('keeps an accepted draft when multiple dropped files violate the configured count', async () => {
  await act(async () => root.render(<Picker initial={[file]} />));
  await drop([file, file]);
  expect(host.querySelector('[role=alert]')?.textContent).toContain('up to 1');
  expect(changed).not.toHaveBeenCalled();
  expect(host.textContent).toContain('proof.pdf');
});
it('supports multiple files and independently named progress bars', async () => {
  const other = new File(['pdf'], 'second.pdf', { type: 'application/pdf' });
  await act(async () =>
    root.render(
      <Picker
        initial={[file, other]}
        maxFiles={2}
        disabled
        progress={[
          { file, loaded: 1, total: 3, phase: 'uploading' },
          { file: other, loaded: 3, total: 3, phase: 'confirming' },
        ]}
      />
    )
  );
  expect(host.querySelectorAll('[role=progressbar]')).toHaveLength(2);
  expect(host.querySelectorAll('[role=progressbar]')[0]?.getAttribute('aria-valuenow')).toBe('33');
  expect(host.querySelectorAll('[role=progressbar]')[1]?.getAttribute('aria-valuenow')).toBe('100');
  expect(host.querySelectorAll('[role=status][aria-live=polite]')).toHaveLength(2);
});
it.each([null, { ...policy, formats: [] }])(
  'fails closed while constraints are unavailable or deny every format',
  async (rules) => {
    await act(async () => root.render(<Picker rules={rules} />));
    await drop([file]);
    expect(host.querySelector('button')?.disabled).toBe(true);
    expect(changed).not.toHaveBeenCalled();
  }
);
it('shows specific type and size feedback without replacing accepted files', async () => {
  await act(async () => root.render(<Picker initial={[file]} />));
  await drop([new File(['x'], 'bad.exe', { type: 'application/pdf' })]);
  expect(host.querySelector('[role=alert]')?.textContent).toContain('.exe');
  await drop([new File(['x'], 'README', { type: 'text/plain' })]);
  expect(host.querySelector('[role=alert]')?.textContent).toContain('text/plain');
  await drop([new File(['x'], 'README')]);
  expect(host.querySelector('[role=alert]')?.textContent).toContain('README');
  const large = new File(['x'], 'large.pdf', { type: 'application/pdf' });
  Object.defineProperty(large, 'size', { value: 1048577 });
  await drop([large]);
  expect(host.querySelector('[role=alert]')?.textContent).toContain('1 MB');
  expect(changed).not.toHaveBeenCalled();
  expect(host.textContent).toContain('proof.pdf');
});
it('revalidates a retained draft when the current constraints change', async () => {
  await act(async () => root.render(<Picker initial={[file]} />));
  await act(async () =>
    root.render(<Picker initial={[file]} rules={{ ...policy, maxSizeBytes: 1 }} />)
  );
  expect(host.querySelector('[role=alert]')?.textContent).toContain('1 B');
  expect(changed).not.toHaveBeenCalled();
});
it('adds, orders and removes distinct file objects without detaching progress from duplicate names', async () => {
  const other = new File(['second'], 'proof.pdf', { type: 'application/pdf' });
  await act(async () =>
    root.render(
      <Picker
        initial={[file]}
        maxFiles={2}
        progress={[{ file, loaded: 1, total: 3, phase: 'uploading' }]}
      />
    )
  );
  await drop([other]);
  expect(changed).toHaveBeenLastCalledWith([file, other]);
  const firstRow = host.querySelector('[role=listitem]')!;
  await act(async () => host.querySelector<HTMLButtonElement>('[data-array-action=down]')!.click());
  expect(changed).toHaveBeenLastCalledWith([other, file]);
  expect(host.querySelectorAll('[role=listitem]')[1]).toBe(firstRow);
  expect(firstRow.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('33');
  await drop([new File(['third'], 'third.pdf', { type: 'application/pdf' })]);
  expect(host.querySelector('[role=alert]')?.textContent).toContain('up to 2');
  expect(changed).toHaveBeenLastCalledWith([other, file]);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-array-action=remove]')!.click()
  );
  expect(changed).toHaveBeenLastCalledWith([file]);
  expect(host.querySelector('[role=alert]')).toBeNull();
});
