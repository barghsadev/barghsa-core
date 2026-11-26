import { expect, it } from 'vitest';
import { NOTIFICATION_TYPE_REGISTRY } from '@barghsa/shared/notifications';
import { notificationEventTitle, notificationEventTitles } from '@barghsa/i18n/notification-forms';
import {
  emptyNotificationDraft,
  notificationInvalidFields,
  normalizeNotificationVariables,
  notificationVariableIssues,
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
  variables: [{ rowId: 0, name: 'user.name', description: 'Recipient' }],
};
it('labels every registered event in both languages and preserves custom keys', () => {
  expect(Object.keys(notificationEventTitles).sort()).toEqual(
    Object.keys(NOTIFICATION_TYPE_REGISTRY).sort()
  );
  for (const key of Object.keys(NOTIFICATION_TYPE_REGISTRY)) {
    expect(notificationEventTitle(key, 'en')).toMatch(/[A-Z]/);
    expect(notificationEventTitle(key, 'fa')).toMatch(/[آ-ی]/);
  }
  expect(notificationEventTitle('billing.installment_ready', 'fa')).toBe(
    'billing.installment_ready'
  );
  expect(notificationEventTitle('constructor', 'en')).toBe('constructor');
});
it('validates declared subject and body paths', () => {
  expect(notificationInvalidFields(draft)).toEqual([]);
});
it('preserves punctuation and line breaks while omitting duplicates and blank rows', () => {
  const description = 'First, as printed: name\nUse the original spelling.';
  const rows = [
    { rowId: 0, name: ' name ', description: ` ${description} ` },
    { rowId: 1, name: 'name', description: 'Second' },
    { rowId: 2, name: 'link', description: null },
    { rowId: 3, name: '', description: '' },
  ];
  expect(normalizeNotificationVariables(rows)).toEqual([
    { name: 'name', description },
    { name: 'link', description: null },
  ]);
  expect(notificationVariableIssues(rows)).toEqual([null, 'variableDuplicate', null, null]);
  expect(notificationInvalidFields({ ...draft, variables: [...draft.variables, ...rows] })).toEqual(
    ['variables']
  );
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
    variables: [
      { rowId: 0, name: '', description: 'missing name' },
      { rowId: 1, name: 'x'.repeat(101), description: 'description' },
    ],
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
