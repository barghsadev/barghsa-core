import { expect, it } from 'vitest';
import {
  documentTemplatesSearch,
  notificationTemplatesSearch,
  documentTemplateQueryOptions,
  notificationTemplateQueryOptions,
} from './template-catalogue-query.js';
import { writeListQuery } from '../hooks/useListQuery.js';

it('keeps document search and category without serializing editor work or unsupported pagination', () => {
  expect(
    documentTemplatesSearch({
      q: ' Invoice ',
      category: 'invoice',
      title: 'Private draft',
      files: ['private.pdf'],
      templateId: 'private',
      cursor: 'unsupported',
      sort: 'title',
    })
  ).toEqual({ q: 'Invoice', category: 'invoice' });
});
it.each([
  { q: ['Invoice'], category: ['invoice'] },
  { q: 'x'.repeat(101), category: 'removed' },
])('rejects invalid document catalogue criteria', (raw) => {
  expect(documentTemplatesSearch(raw)).toEqual({ q: undefined, category: undefined });
});
it('keeps all notification filter criteria and excludes message, destination and credentials', () => {
  expect(
    notificationTemplatesSearch({
      eventKey: ' invoice.issued ',
      locale: 'fa',
      channel: 'sms',
      status: 'draft',
      bodyTemplate: 'Private message',
      testDestination: '+989121234567',
      password: 'private',
      q: 'unsupported',
    })
  ).toEqual({ eventKey: 'invoice.issued', locale: 'fa', channel: 'sms', status: 'draft' });
});
it.each([
  { locale: ['fa'], channel: ['sms'], status: ['draft'] },
  { locale: 'fr', channel: 'push', status: 'published' },
])('rejects unsupported notification filters', (raw) => {
  expect(notificationTemplatesSearch(raw)).toEqual({
    locale: undefined,
    channel: undefined,
    status: undefined,
  });
});
it('updates one applied filter independently and clears defaults canonically', () => {
  const document = documentTemplatesSearch({ q: 'Invoice', category: 'invoice' });
  expect(
    documentTemplatesSearch(
      writeListQuery(document, documentTemplateQueryOptions, { filters: { category: '' } })
    )
  ).toEqual({ q: 'Invoice', category: undefined });
  const notification = notificationTemplatesSearch({
    eventKey: ' invoice.issued ',
    locale: 'fa',
    channel: 'sms',
    status: 'draft',
  });
  expect(
    notificationTemplatesSearch(
      writeListQuery(notification, notificationTemplateQueryOptions, {
        filters: { channel: 'email' },
      })
    )
  ).toEqual({ eventKey: 'invoice.issued', locale: 'fa', channel: 'email', status: 'draft' });
});

it.each(
  [['invoice.issued'], 'invoice issued', 'x'.repeat(101), 42, { key: 'invoice.issued' }].map(
    (eventKey) => ({ eventKey })
  )
)('drops invalid event criteria while preserving independent filters', ({ eventKey }) => {
  expect(
    notificationTemplatesSearch({
      eventKey,
      channel: 'email',
      status: 'archived',
      preview_event: 'independent',
    })
  ).toMatchObject({
    eventKey: undefined,
    channel: 'email',
    status: 'archived',
    preview_event: 'independent',
  });
});
it('keeps literal wildcard characters and allows clearing the event filter independently', () => {
  const raw = notificationTemplatesSearch({
    eventKey: "literal'_%",
    channel: 'email',
    status: 'archived',
    preview_event: 'independent',
  });
  expect(raw.eventKey).toBe("literal'_%");
  expect(raw.preview_event).toBe('independent');
  expect(
    notificationTemplatesSearch(
      writeListQuery(raw, notificationTemplateQueryOptions, { filters: { eventKey: '' } })
    )
  ).toMatchObject({
    eventKey: undefined,
    channel: 'email',
    status: 'archived',
    preview_event: 'independent',
  });
});
