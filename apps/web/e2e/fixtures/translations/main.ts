import { t } from '@barghsa/i18n/auth';
import { contractTemplatesText } from '@barghsa/i18n/contract-templates';
import { tWalletLimit } from '@barghsa/i18n/wallet-limit';
import { tWalletReceipts } from '@barghsa/i18n/wallet-receipts';

const resolvers: Record<string, (key: string, locale: 'fa' | 'en') => string> = {
  auth: t,
  templates: contractTemplatesText,
  limit: tWalletLimit,
  receipts: tWalletReceipts,
};
const dictionary = document.querySelector<HTMLSelectElement>('#resolver')!;
const language = document.querySelector<HTMLSelectElement>('#locale')!;
const message = document.querySelector<HTMLInputElement>('#message')!;
const output = document.querySelector<HTMLOutputElement>('#result')!;
function translate() {
  const resolve = resolvers[dictionary.value];
  if (!resolve) throw new Error('Unknown fixture dictionary');
  output.textContent = resolve(message.value, language.value === 'fa' ? 'fa' : 'en');
}
for (const control of [dictionary, language, message]) control.addEventListener('input', translate);
translate();
