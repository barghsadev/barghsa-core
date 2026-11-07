import { act, type ReactNode } from 'react';
import { ConfirmProvider } from '@barghsa/ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { QueryProvider } from './query-provider.js';

/** Supply the same confirmation host used by the application shell. */
export function ConfirmationTestProvider({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </QueryProvider>
  );
}

/** Perform the additional user approval before testing a domain command or retry. */
export async function approveVisibleConfirmation(scope: ParentNode = document) {
  const phrase = scope.querySelector<HTMLInputElement>(
    '[data-slot=destructive-confirmation] input'
  );
  if (phrase) {
    const label = scope.querySelector('[data-slot=destructive-confirmation] label')?.textContent;
    const locale = label === confirmationText('typePhrase', 'en') ? 'en' : 'fa';
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        phrase,
        confirmationText('phrase', locale)
      );
      phrase.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  for (const checkbox of scope.querySelectorAll<HTMLElement>(
    '[data-slot=financial-confirmation] [role=checkbox]'
  )) {
    if (checkbox.getAttribute('aria-checked') !== 'true') await act(async () => checkbox.click());
  }
}
