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
      locale: 'fa',
      channel: 'sms',
      status: 'draft',
      bodyTemplate: 'Private message',
      testDestination: '+989121234567',
      password: 'private',
      q: 'unsupported',
    })
  ).toEqual({ locale: 'fa', channel: 'sms', status: 'draft' });
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
  ).toEqual({ locale: 'fa', channel: 'email', status: 'draft' });
});
