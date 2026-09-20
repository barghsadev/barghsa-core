import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ theme: undefined as string | undefined }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: state.theme }) }));
vi.mock('sonner', () => ({
  Toaster: ({ theme }: { theme: string }) => <span data-theme={theme} />,
}));
import { Toaster } from './sonner';
beforeEach(() => {
  state.theme = undefined;
});
for (const theme of [undefined, 'brand', 'system', 'light', 'dark']) {
  it(`passes a supported toast theme for ${String(theme)}`, () => {
    state.theme = theme;
    const expected = theme === 'light' || theme === 'dark' ? theme : 'system';
    expect(renderToStaticMarkup(<Toaster />)).toContain(`data-theme="${expected}"`);
  });
}
it('preserves an explicit caller theme override', () => {
  state.theme = 'dark';
  expect(renderToStaticMarkup(<Toaster theme="light" />)).toContain('data-theme="light"');
});
