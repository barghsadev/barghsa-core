import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { UiDirectionProvider } from './UiDirectionProvider.js';
import { DirectionAware } from '../components/DirectionAware.js';
import { useDirection } from '../hooks/useDirection.js';

function Consumer() {
  const { dir, isRtl, isLtr } = useDirection();
  return (
    <output data-dir={dir} data-rtl={isRtl} data-ltr={isLtr}>
      <DirectionAware rtl="Persian" ltr="English" />
    </output>
  );
}
it('updates the document, hook and directional content together when locale changes', async () => {
  const host = document.createElement('div'),
    root = createRoot(host);
  const previousLang = document.documentElement.lang,
    previousDir = document.documentElement.dir;
  document.body.append(host);
  try {
    document.documentElement.lang = 'fa';
    await act(async () =>
      root.render(
        <UiDirectionProvider>
          <Consumer />
        </UiDirectionProvider>
      )
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(host.querySelector('output')?.dataset).toMatchObject({
      dir: 'rtl',
      rtl: 'true',
      ltr: 'false',
    });
    expect(host.textContent).toBe('Persian');
    await act(async () => {
      document.documentElement.lang = 'en';
    });
    expect(document.documentElement.dir).toBe('ltr');
    expect(host.querySelector('output')?.dataset).toMatchObject({
      dir: 'ltr',
      rtl: 'false',
      ltr: 'true',
    });
    expect(host.textContent).toBe('English');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    document.documentElement.lang = previousLang;
    document.documentElement.dir = previousDir;
  }
});
