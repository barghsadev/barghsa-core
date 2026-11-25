import { describe, expect, it } from 'vitest';
import { safeParse } from 'zod/mini';
import {
  confirmedSolarGuidance,
  solarGuidanceBody,
  solarGuidanceDraft,
} from './solar-document-form.js';
import { solarGuidanceSchema, solarReviewSchema } from './solar-document-form-schemas.js';

const messages = {
  fa: 'guidance',
  en: 'guidance',
  items: 'suggestions',
};
const draft = {
  fa: ' راهنما ',
  en: ' Guidance ',
  items: [
    { fa: ' سند اول ', en: ' First file ' },
    { fa: ' سند دوم ', en: ' Second file ' },
  ],
};
const paths = (value: ReturnType<typeof safeParse>) =>
  value.success ? [] : value.error.issues.map((issue) => issue.path.join('.'));

describe('solar review form', () => {
  for (const [intent, limit] of [
    ['reject', 1000],
    ['request_additional', 2000],
  ] as const) {
    it(`${intent} requires meaningful text and accepts its exact trimmed limit`, () => {
      const schema = solarReviewSchema(intent, 'localized');
      for (const text of ['', '   ', 'x'.repeat(limit + 1)])
        expect(paths(safeParse(schema, { reason: text }))).toEqual(['reason']);
      expect(safeParse(schema, { reason: ' ' + 'x'.repeat(limit) + ' ' }).success).toBe(true);
    });
  }
  it('additional descriptions between 1000 and 2000 do not use the rejection limit', () => {
    expect(
      safeParse(solarReviewSchema('reject', 'reject'), { reason: 'x'.repeat(1500) }).success
    ).toBe(false);
    expect(
      safeParse(solarReviewSchema('request_additional', 'additional'), { reason: 'x'.repeat(1500) })
        .success
    ).toBe(true);
  });
});
describe('solar guidance form', () => {
  it('trims both languages and pairs nonblank suggestions in order', () => {
    expect(safeParse(solarGuidanceSchema(messages), draft).success).toBe(true);
    const body = solarGuidanceBody(draft);
    expect(body).toEqual({
      fa: 'راهنما',
      en: 'Guidance',
      suggestions: [
        { fa: 'سند اول', en: 'First file' },
        { fa: 'سند دوم', en: 'Second file' },
      ],
    });
    expect(solarGuidanceDraft(body)).toEqual({
      fa: 'راهنما',
      en: 'Guidance',
      items: body.suggestions,
    });
  });
  for (const field of ['fa', 'en'] as const) {
    it(`${field} enforces required text and the 4000-character boundary`, () => {
      for (const value of ['', '  ', 'x'.repeat(4001)])
        expect(
          paths(safeParse(solarGuidanceSchema(messages), { ...draft, [field]: value }))
        ).toEqual([field]);
      expect(
        safeParse(solarGuidanceSchema(messages), { ...draft, [field]: 'x'.repeat(4000) }).success
      ).toBe(true);
    });
  }
  it('validates both translations, exact limits, and the optional empty list', () => {
    const schema = solarGuidanceSchema(messages);
    const items = Array.from({ length: 30 }, () => ({ fa: 'x'.repeat(200), en: 'x'.repeat(200) }));
    expect(safeParse(schema, { ...draft, items }).success).toBe(true);
    expect(paths(safeParse(schema, { ...draft, items: [...items, items[0]] }))).toEqual(['items']);
    expect(
      paths(safeParse(schema, { ...draft, items: [{ fa: ' ', en: 'x'.repeat(201) }] }))
    ).toEqual(['items.0.fa', 'items.0.en']);
    expect(safeParse(schema, { ...draft, items: [] }).success).toBe(true);
  });
  it('keeps an existing line break inside its original translation pair', () => {
    const current = {
      ...solarGuidanceBody(draft),
      suggestions: [{ fa: 'صفحه اول\nصفحه دوم', en: 'Both pages' }],
    };
    expect(solarGuidanceBody(solarGuidanceDraft(current))).toEqual(current);
  });
  it('requires all captured receipt content and suggestion order to match', () => {
    const body = solarGuidanceBody(draft);
    expect(confirmedSolarGuidance({ ...body, unrelatedMetadata: true }, body)).toBe(true);
    for (const receipt of [
      null,
      [],
      {},
      { ...body, fa: 'wrong' },
      { ...body, en: 'wrong' },
      { ...body, suggestions: [] },
      { ...body, suggestions: [...body.suggestions].reverse() },
      { ...body, suggestions: [{ fa: 'سند اول' }] },
    ])
      expect(confirmedSolarGuidance(receipt, body)).toBe(false);
  });
});
