import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdminTosPage from './AdminTosPage.js';
// The editor widget has browser coverage; these tests isolate the server acknowledgement contract.
vi.mock('./TosRichText.js', () => ({
  default: ({
    value,
    onChange,
    label,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    label: string;
    disabled: boolean;
  }) => (
    <textarea
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    />
  ),
}));
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ status: 'ready', timezone: 'UTC', retry: () => {} }),
}));
let host: HTMLDivElement, root: Root;
const valid = {
  id: 'draft-one',
  revision: 'a'.repeat(64),
  versionId: 'v2',
  contentFa: 'شرایط',
  contentEn: 'Terms',
  status: 'draft',
  changeType: null,
  isActive: false,
  createdBy: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  publishedAt: null,
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function fill() {
  await act(async () => root.render(<AdminTosPage />));
  await act(async () =>
    Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent === 'New Draft')!
      .click()
  );
  for (const [selector, value] of [
    ['input', 'v2'],
    ['textarea[aria-label="Persian content"]', 'شرایط'],
    ['textarea[aria-label="English content"]', 'Terms'],
  ]) {
    const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector!)!;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}
it.each([
  { name: 'invalid', data: null },
  { name: 'missing revision', data: { ...valid, revision: undefined } },
  { name: 'published', data: { ...valid, status: 'published', publishedAt: valid.createdAt } },
  { name: 'wrong version', data: { ...valid, versionId: 'v3' } },
  { name: 'wrong Persian', data: { ...valid, contentFa: 'other' } },
  { name: 'wrong English', data: { ...valid, contentEn: 'other' } },
  { name: 'taken string', status: 409, data: { error: 'TOS_VERSION_ID_TAKEN' } },
  { name: 'taken nested', status: 409, data: { error: { code: 'TOS_VERSION_ID_TAKEN' } } },
  { name: 'conflict', status: 409, data: {} },
  { name: 'malformed conflict', status: 409, data: null },
  { name: 'unknown conflict', status: 409, data: { error: { code: 12 } } },
  { name: 'unavailable', status: 503, data: {} },
  { name: 'matching', data: valid, success: true },
])('preserves local terms until create acknowledgement is confirmed: $name', async (scenario) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url, init) =>
        new Response(JSON.stringify(init?.method === 'POST' ? scenario.data : []), {
          status: init?.method === 'POST' ? (scenario.status ?? 200) : 200,
        })
    )
  );
  await fill();
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(JSON.parse(String(writes[0]![1]?.body))).toEqual({
    versionId: 'v2',
    contentFa: 'شرایط',
    contentEn: 'Terms',
  });
  if (scenario.success) {
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('[role=alert]')).toBeNull();
  } else {
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    expect(
      host.querySelector<HTMLTextAreaElement>('textarea[aria-label="English content"]')?.value
    ).toBe('Terms');
  }
});
