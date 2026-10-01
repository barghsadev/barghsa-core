import { act, StrictMode, type FormEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsFormSection } from './SettingsFormSection.js';
import { toast } from '../lib/toast-api.js';
vi.mock('../lib/toast-api.js', () => ({ toast: { success: vi.fn() } }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(toast.success).mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(saved: boolean, message = 'Section saved.') {
  await act(async () =>
    root.render(
      <StrictMode>
        <SettingsFormSection
          title="Terms"
          description="Terms only"
          saved={saved}
          savedMessage={message}
          actions={<button type="submit">Save terms</button>}
        >
          <input aria-label="Duration" />
        </SettingsFormSection>
      </StrictMode>
    )
  );
}
it('notifies once per confirmed save through StrictMode, rerenders and language changes', async () => {
  await render(false);
  expect(toast.success).not.toHaveBeenCalled();
  await render(true);
  await render(true);
  await render(true, 'بخش ذخیره شد.');
  expect(toast.success).toHaveBeenCalledTimes(1);
  await render(false);
  await render(true);
  expect(toast.success).toHaveBeenCalledTimes(2);
});
it('does not notify for a confirmation proposal or an unsuccessful save', async () => {
  await render(false);
  await render(false);
  expect(toast.success).not.toHaveBeenCalled();
});
it('submits and labels each section independently without nested forms', async () => {
  const handlers = [
    vi.fn((event: FormEvent) => event.preventDefault()),
    vi.fn((event: FormEvent) => event.preventDefault()),
  ];
  await act(async () =>
    root.render(
      <>
        {handlers.map((handler, index) => (
          <SettingsFormSection
            key={index}
            title={`Section ${index}`}
            onSubmit={handler}
            actions={<button type="submit">Save {index}</button>}
          >
            <input aria-label={`Value ${index}`} />
          </SettingsFormSection>
        ))}
      </>
    )
  );
  const forms = [...host.querySelectorAll('form')];
  expect(forms).toHaveLength(2);
  expect(host.querySelector('form form')).toBeNull();
  expect(new Set(forms.map((form) => form.getAttribute('aria-labelledby'))).size).toBe(2);
  await act(async () => forms[1]!.querySelector('button')!.click());
  expect(handlers[1]).toHaveBeenCalledTimes(1);
  expect(handlers[0]).not.toHaveBeenCalled();
});
