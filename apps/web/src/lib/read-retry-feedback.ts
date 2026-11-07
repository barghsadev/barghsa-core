import { loadingText } from '@barghsa/i18n/loading-feedback';
import type { Locale } from '@barghsa/i18n/app';
import { sendToast } from './toast-api.js';

export function announceReadRetry(locale: Locale) {
  sendToast('info', loadingText('connectionRetry', locale), { id: 'read-connection-retry' });
}
