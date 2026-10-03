import { expect, it } from 'vitest';
import {
  emptyNotificationDraft,
  notificationInvalidFields,
  parseVariablesText,
  windowInvalidFields,
  windowBody,
  windowValues,
  validWindow,
  windowBasis,
} from './notification-form.js';
const draft = {
  ...emptyNotificationDraft,
  eventKey: 'invoice.issued',
  bodyTemplate: 'Hello {{user.name}}',
  subject: 'For {{user.name}}',
  variables: 'user.name: Recipient',
};
it('validates declared subject/body paths and preserves variable descriptions/deduplication', () => {
  expect(notificationInvalidFields(draft)).toEqual([]);
  expect(parseVariablesText('name: First, name: Second\nlink')).toEqual([
    { name: 'name', description: 'First' },
    { name: 'link', description: null },
  ]);
});
it.each(['{{unknown}}', '{{user.__proto__}}', '{{user.name', '{{}}'])(
  'rejects unsafe/unknown/malformed placeholders %s',
  (bodyTemplate) => {
    expect(notificationInvalidFields({ ...draft, bodyTemplate })).toContain('bodyTemplate');
    expect(notificationInvalidFields({ ...draft, subject: bodyTemplate })).toContain('subject');
  }
);
it('rejects blank content, event whitespace and overlong variable metadata without clearing raw values', () => {
  const value = {
    ...draft,
    eventKey: 'two words',
    bodyTemplate: '  ',
    variables: ': missing, ' + 'x'.repeat(101) + ': description',
    subject: 's'.repeat(201),
  };
  expect(notificationInvalidFields(value)).toEqual([
    'eventKey',
    'subject',
    'bodyTemplate',
    'variables',
  ]);
  expect(value.bodyTemplate).toBe('  ');
});
it('round-trips precise minute boundaries and timezone', () => {
  const config = { timezone: 'Asia/Tehran', startHour: 9.25, endHour: 21.5 };
  expect(windowValues(config)).toEqual({
    timezone: 'Asia/Tehran',
    startHour: '09:15',
    endHour: '21:30',
  });
  expect(windowBody(windowValues(config))).toEqual(config);
  expect(validWindow(config)).toBe(true);
  expect(windowBasis(config)).not.toBe(windowBasis({ ...config, startHour: 9 }));
});
it.each(['', '9:00', '24:00', '09:00:30', '۰۹:۰۰'])(
  'rejects ambiguous native time %s',
  (startHour) => {
    expect(windowInvalidFields({ timezone: 'UTC', startHour, endHour: '21:00' })).toContain(
      'startHour'
    );
  }
);
it('requires a same-day window of at least four hours and a real timezone', () => {
  expect(windowInvalidFields({ timezone: 'UTC', startHour: '09:15', endHour: '13:15' })).toEqual(
    []
  );
  expect(windowInvalidFields({ timezone: 'UTC', startHour: '09:15', endHour: '13:14' })).toEqual([
    'endHour',
  ]);
  expect(windowInvalidFields({ timezone: 'UTC', startHour: '22:00', endHour: '06:00' })).toEqual([
    'endHour',
  ]);
  expect(
    windowInvalidFields({ timezone: 'unknown', startHour: '09:00', endHour: '21:00' })
  ).toEqual(['timezone']);
  expect(validWindow({ timezone: 'UTC', startHour: '9', endHour: 21 })).toBe(false);
});
