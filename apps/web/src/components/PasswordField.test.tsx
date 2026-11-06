import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { passwordStrengthFeedback } from '@barghsa/i18n/password-strength-feedback';
import { PasswordField } from './PasswordField.js';
const estimate = vi.hoisted(() => ({ score: 0, calls: vi.fn() }));
vi.mock('../lib/password-strength.js', () => ({
  passwordStrengthFeedback,
  evaluateStrength: () => {
    estimate.calls();
    return { score: estimate.score, level: 'weak' };
  },
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  estimate.calls.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function fill(value: string) {
  await act(async () => {
    const input = host.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
for (const locale of ['en', 'fa'] as const)
  it(`${locale}: displays every score with a localized hint and retains nonempty feedback after blur`, async () => {
    await act(async () => root.render(<PasswordField locale={locale} />));
    const container = host.querySelector('#password-strength')!;
    expect(container.getAttribute('aria-hidden')).toBe('true');
    const labels =
      locale === 'fa'
        ? ['خیلی ضعیف', 'ضعیف', 'متوسط', 'قوی', 'بسیار قوی']
        : ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
    const hints =
      locale === 'fa'
        ? [
            'از رمزهای رایج',
            'چند واژه',
            'رمز را با واژه',
            'برای اطمینان بیشتر',
            'این رمز را برای حساب دیگری',
          ]
        : [
            'Avoid common passwords',
            'Add more unrelated words',
            'Make it longer',
            'Add length',
            'Keep this password unique',
          ];
    for (let index = 0; index < 5; index++) {
      estimate.score = index * 25;
      await fill('Local test draft ' + index);
      await vi.waitFor(() =>
        expect(host.querySelector('[role=progressbar]')?.getAttribute('aria-valuetext')).toBe(
          labels[index]
        )
      );
      expect(container.getAttribute('aria-hidden')).toBe('false');
      expect(container.textContent).toContain(hints[index]);
      const segments = [...host.querySelectorAll('[role=progressbar] > span')];
      expect(segments).toHaveLength(4);
      const filled = segments.filter((segment) => !segment.classList.contains('bg-muted'));
      expect(filled).toHaveLength(Math.max(1, index));
      expect(
        filled[0]!.classList.contains(
          ['bg-destructive', 'bg-destructive', 'bg-orange-500', 'bg-yellow-500', 'bg-success'][
            index
          ]!
        )
      ).toBe(true);
      expect(host.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe(
        String(index * 25)
      );
    }
    await act(async () => {
      host.querySelector('input')!.focus();
      host.querySelector('input')!.blur();
    });
    expect(container.getAttribute('aria-hidden')).toBe('false');
    await fill('');
    expect(container.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelectorAll('[role=progressbar] > span:not(.bg-muted)')).toHaveLength(0);
  });
it('keeps the estimator optional and visibility toggling independent of form submission', async () => {
  await act(async () => root.render(<PasswordField showStrength={false} locale="en" />));
  await fill('Raw credential');
  const toggle = host.querySelector('button')!;
  expect(toggle.type).toBe('button');
  await act(async () => toggle.click());
  expect(host.querySelector('input')!.type).toBe('text');
  await act(async () => toggle.click());
  expect(host.querySelector('input')!.type).toBe('password');
  expect(estimate.calls).not.toHaveBeenCalled();
  expect(host.querySelector('[role=progressbar]')).toBeNull();
});
