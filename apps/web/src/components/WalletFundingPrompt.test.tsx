import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WalletFundingPrompt } from './WalletFundingPrompt.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: (value: string) => `${value} IRR` }),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it('shows the shortfall and wallet funding route only when funds are insufficient', async () => {
  await act(async () => root.render(<WalletFundingPrompt balance="300" total="1000" />));
  expect(container.textContent).toContain('700 IRR');
  expect(container.textContent).toContain('bank receipt');
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/wallet');
  await act(async () => root.render(<WalletFundingPrompt balance="1000" total="1000" />));
  expect(container.textContent).toBe('');
});
