import { expect, it } from 'vitest';
import { notificationFormText, type NotificationFormKey } from './notification-forms.js';
it.each(['en', 'fa'] as const)(
  'owns complete localized field/recovery feedback in %s',
  (locale) => {
    const keys: NotificationFormKey[] = [
      'eventKey',
      'channel',
      'locale',
      'subject',
      'bodyTemplate',
      'variables',
      'timezone',
      'startHour',
      'endHour',
      'validationUnavailable',
      'stale',
      'uncertain',
      'reset',
      'refresh',
      'denied',
    ];
    for (const key of keys) {
      expect(notificationFormText(key, locale)).toBeTruthy();
      expect(notificationFormText(key, 'en')).not.toBe(notificationFormText(key, 'fa'));
    }
  }
);
